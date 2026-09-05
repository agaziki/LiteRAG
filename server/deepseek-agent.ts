/**
 * DeepSeek Agent 引擎
 *
 * 用 OpenAI 兼容 SDK 接入 DeepSeek，实现带函数调用（Function Calling）的 Agent 循环。
 * 定义三个专用工具（search_faq / record_intent / escalate_to_human），
 * 由服务端直接执行（调用本地 FAQ/DB 函数），无需给模型 Bash 权限，更安全。
 *
 * 流式输出文本 + 工具调用事件，与原 CodeBuddy SDK 的 SSE 事件格式兼容：
 *   onText / onToolStart / onToolResult / onDone / onError
 */

import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { searchKnowledge } from "./faq.js";
import * as db from "./db.js";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface RunAgentOptions {
  sessionId: string;
  message: string;
  /** 图片（data URL），仅 deepseek-v4-flash-vision-exp 等视觉模型支持 */
  images?: string[];
  model: string;
  systemPrompt: string;
  /** 历史对话（不含当前新消息），按时间正序 */
  history: AgentMessage[];
  maxTurns?: number;
  onText: (chunk: string) => void;
  onToolStart: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolResult: (id: string, result: string, isError: boolean) => void;
  onDone: (info: { duration: number; turns: number }) => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

// ============ 工具定义（OpenAI Function Calling 格式） ============

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_faq",
      description:
        "搜索客服知识库（FAQ 问答条目 + 文档知识库），返回最相关的内容。每当用户提出退款、查询订单、技术支持、投诉等咨询问题时，必须先调用此工具检索，再组织回复。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "从用户问题中提取的 2-4 个核心关键词，用于检索。例如：退款到账、订单物流、登录失败",
          },
          limit: {
            type: "number",
            description: "返回条目数量，默认 3，最大 10",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "record_intent",
      description:
        "记录本轮对话识别出的用户意图。每轮对话识别意图后调用一次，便于管理后台统计分析。同一意图不要重复记录。",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            enum: ["refund", "order", "tech", "general", "other"],
            description: "refund=退款; order=查询订单; tech=技术支持; general=通用咨询; other=无法归类",
          },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "意图识别置信度：high=明确; medium=较明确; low=不确定",
          },
        },
        required: ["intent"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "escalate_to_human",
      description:
        "将当前会话转接给人工客服。当出现以下情况时必须调用：用户明确要求转人工；连续 2 轮仍无法确定意图；涉及实际执行退款/修改订单等高风险操作；同一问题追问 2 次未解决；涉及账号冻结/资金安全等敏感问题。调用后向用户说明已转人工。",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "转人工的原因简述",
          },
          intent: {
            type: "string",
            enum: ["refund", "order", "tech", "general", "other"],
            description: "当前会话识别出的意图（如有）",
          },
        },
        required: ["reason"],
      },
    },
  },
];

// ============ 工具执行（直接调用本地函数，不经 HTTP） ============

interface ToolExecResult {
  content: string;
  isError: boolean;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  sessionId: string
): Promise<ToolExecResult> {
  try {
    if (name === "search_faq") {
      const query = String(input.query || "");
      const limit = Math.min(Number(input.limit) || 3, 10);
      const results = await searchKnowledge(query, limit);
      return {
        content: JSON.stringify({
          count: results.length,
          results: results.map(r => r.type === "faq"
            ? {
                type: r.type,
                id: r.id,
                category: r.category,
                question: r.question,
                answer: r.answer,
                score: r.score,
                tags: r.tags,
              }
            : {
                type: r.type,
                id: r.id,
                docName: r.category,
                title: r.title,
                excerpt: r.answer,
                score: r.score,
              }),
        }),
        isError: false,
      };
    }

    if (name === "record_intent") {
      const intent = String(input.intent || "other");
      const confidence = String(input.confidence || "medium");
      const record = db.createSessionIntent({
        session_id: sessionId,
        intent,
        confidence,
      });
      return {
        content: JSON.stringify({ success: true, recorded: record.intent }),
        isError: false,
      };
    }

    if (name === "escalate_to_human") {
      const reason = String(input.reason || "用户请求转人工");
      const intent = input.intent ? String(input.intent) : null;
      const record = db.createEscalation({
        id: uuidv4(),
        session_id: sessionId,
        reason,
        intent,
        created_at: new Date().toISOString(),
      });
      return {
        content: JSON.stringify({
          success: true,
          escalationId: record.id,
          status: record.status,
          message: "已创建转人工工单，人工客服将在服务时间内接入",
        }),
        isError: false,
      };
    }

    return { content: JSON.stringify({ error: `未知工具: ${name}` }), isError: true };
  } catch (e: any) {
    return { content: JSON.stringify({ error: e?.message || String(e) }), isError: true };
  }
}

// ============ OpenAI 客户端（懒加载） ============

let clientInstance: OpenAI | null = null;

function getClient(): OpenAI {
  if (clientInstance) return clientInstance;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 DEEPSEEK_API_KEY，请在 .env 或设置页中填入 DeepSeek API Key");
  }
  clientInstance = new OpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey,
  });
  return clientInstance;
}

/** 重置客户端（配置变更后调用） */
export function resetClient(): void {
  clientInstance = null;
}

// ============ 图片（视觉模型）支持 ============

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 单张原始大小上限 5MB

/** 校验并规整图片列表（data URL），不合法直接抛错 */
export function validateImages(images: unknown): string[] {
  if (images === undefined || images === null) return [];
  if (!Array.isArray(images)) throw new Error("images 必须是字符串数组");
  if (images.length > MAX_IMAGES) throw new Error(`最多上传 ${MAX_IMAGES} 张图片`);
  for (const img of images) {
    if (typeof img !== "string" || !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(img)) {
      throw new Error("图片格式不支持（仅支持 png/jpeg/webp/gif 的 data URL）");
    }
    const base64 = img.split(",")[1] ?? "";
    if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
      throw new Error("单张图片不能超过 5MB");
    }
  }
  return images as string[];
}

/**
 * 构建视觉模型的用户消息内容：无图片时为纯文本；有图片时为
 * [文本, image_url...] 数组（OpenAI 兼容多模态格式）。
 */
export function buildUserContent(
  message: string,
  images?: string[]
): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
  if (!images || images.length === 0) return message;
  return [
    { type: "text", text: message },
    ...images.map(url => ({ type: "image_url" as const, image_url: { url } })),
  ];
}

// ============ Agent 主循环 ============

export async function runDeepSeekAgent(opts: RunAgentOptions): Promise<void> {
  const {
    sessionId,
    message,
    images,
    model,
    systemPrompt,
    history,
    maxTurns = 8,
    onText,
    onToolStart,
    onToolResult,
    onDone,
    onError,
    signal,
  } = opts;

  const startedAt = Date.now();
  const client = getClient();

  // 构建消息序列：系统提示 + 历史 + 当前用户消息（可能含图片）
  const messages: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam> = [
    { role: "system", content: systemPrompt },
    ...history.map(m => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
    { role: "user", content: buildUserContent(message, images) },
  ];

  let totalTurns = 0;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      totalTurns++;
      if (signal?.aborted) throw new Error("已取消");

      // 调用 DeepSeek 流式接口
      const stream = await client.chat.completions.create(
        {
          model,
          messages,
          tools: TOOLS,
          tool_choice: "auto",
          stream: true,
        },
        { signal }
      );

      let textBuf = "";
      // 按工具调用的 index 累积 {id, name, arguments}
      const toolAccum: Record<number, { id: string; name: string; arguments: string }> = {};

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // 文本增量
        if (delta.content) {
          textBuf += delta.content;
          onText(delta.content);
        }

        // 工具调用增量
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolAccum[idx]) {
              toolAccum[idx] = { id: tc.id || uuidv4(), name: "", arguments: "" };
            }
            if (tc.id) toolAccum[idx].id = tc.id;
            if (tc.function?.name) toolAccum[idx].name = tc.function.name;
            if (tc.function?.arguments) toolAccum[idx].arguments += tc.function.arguments;
          }
        }
      }

      const assembledToolCalls = Object.values(toolAccum);
      const hasToolCalls = assembledToolCalls.length > 0;

      // 把本轮助手消息加入上下文
      messages.push({
        role: "assistant",
        content: textBuf || null,
        ...(hasToolCalls
          ? {
              tool_calls: assembledToolCalls.map(tc => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
      });

      // 无工具调用 → 最终回答，结束循环
      if (!hasToolCalls) {
        break;
      }

      // 执行每个工具调用，并把结果作为 tool 消息回传
      for (const tc of assembledToolCalls) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch {
          parsedInput = { _raw: tc.arguments };
        }

        onToolStart(tc.id, tc.name, parsedInput);
        const result = await executeTool(tc.name, parsedInput, sessionId);
        onToolResult(tc.id, result.content, result.isError);

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.content,
        } as OpenAI.Chat.Completions.ChatCompletionToolMessageParam);
      }
      // 继续下一轮，让模型基于工具结果生成回复
    }

    onDone({ duration: Date.now() - startedAt, turns: totalTurns });
  } catch (error: any) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}

// ============ 可用模型 ============

export function getDeepSeekModels() {
  return [
    {
      modelId: "deepseek-v4-flash",
      name: "DeepSeek V4-Flash (deepseek-v4-flash)",
      description: "V4 系列高效 MoE 模型（公测），支持函数调用与长上下文，性价比高，客服场景推荐",
    },
    {
      modelId: "deepseek-v4-flash-vision-exp",
      name: "DeepSeek V4-Flash Vision Exp (deepseek-v4-flash-vision-exp)",
      description: "实验版：在 V4-Flash 基础上支持图片输入（当前对话界面暂未提供图片上传，仅文本调用同样可用）",
    },
  ];
}

export const DEFAULT_MODEL = "deepseek-v4-flash";
