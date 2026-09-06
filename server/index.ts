import express from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import multer from "multer";
import * as db from "./db.js";
import {
  searchKnowledge, listAllFaq, getMinScore,
  addFaqItem, updateFaqItem, deleteFaqItem,
  addFaqCategory, updateFaqCategory, deleteFaqCategory,
  importFaq,
} from "./faq.js";
import { parseImportFile, buildCsvTemplate } from "./faq-import.js";
import { ingestDoc, listDocs, deleteDoc } from "./kb-docs.js";
import { isEmbeddingEnabled } from "./embeddings.js";
import { getTopicBoundary, setTopicBoundary } from "./runtime-config.js";
import { buildCustomerServicePrompt } from "./customer-service-prompt.js";
import { runDeepSeekAgent, getDeepSeekModels, resetClient, DEFAULT_MODEL, validateImages } from "./deepseek-agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 启动时加载 .env（不覆盖已存在的环境变量），无需额外依赖
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = (m[2] || '').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
} catch {
  // .env 加载失败不阻塞启动
}

const app = express();
const PORT = process.env.PORT || 3000;

// 文件上传（知识库导入用，内存模式，限 10MB）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Middleware
// JSON 请求体上限 50MB：容纳图片问答（最多 4 张 × 5MB 图片的 base64，约 27MB）
app.use(express.json({ limit: "50mb" }));

const defaultModel = DEFAULT_MODEL;

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 登录方式类型
type LoginMethod = 'env' | 'none';

interface LoginStatusResponse {
  isLoggedIn: boolean;
  method?: LoginMethod;
  envConfigured?: boolean;
  error?: string;
  apiKey?: string; // 脱敏后的 API Key
  envVars?: {
    apiKey?: string;
    baseUrl?: string;
  };
}

// 检查 DeepSeek API Key 配置状态
app.get("/api/check-login", (req, res) => {
  const response: LoginStatusResponse = {
    isLoggedIn: false,
    envConfigured: false,
    envVars: {},
  };

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL;

  if (apiKey) {
    response.envConfigured = true;
    response.isLoggedIn = true;
    response.method = 'env';
    // 脱敏显示
    response.apiKey = apiKey.slice(0, 6) + '****' + apiKey.slice(-4);
    response.envVars!.apiKey = response.apiKey;
    if (baseUrl) {
      response.envVars!.baseUrl = baseUrl;
    }
  } else {
    response.method = 'none';
    response.error = '未配置 DEEPSEEK_API_KEY，请在 .env 或设置页中填入 DeepSeek API Key（获取：https://platform.deepseek.com）';
  }

  res.json(response);
});

// 保存 DeepSeek 配置（环境变量，仅当前进程有效）
app.post("/api/save-env-config", (req, res) => {
  const { apiKey, baseUrl } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: '请填写 DeepSeek API Key' });
  }

  const configuredVars: string[] = [];

  if (apiKey) {
    process.env.DEEPSEEK_API_KEY = apiKey;
    configuredVars.push('DEEPSEEK_API_KEY');
  }
  if (baseUrl) {
    process.env.DEEPSEEK_BASE_URL = baseUrl;
    configuredVars.push('DEEPSEEK_BASE_URL');
  }

  // 重置 OpenAI 客户端缓存，使新配置生效
  resetClient();

  res.json({
    success: true,
    message: `已设置: ${configuredVars.join(', ')}`,
    note: '环境变量仅在当前服务器进程有效，重启后需要重新设置或写入 .env 文件'
  });
});

// 获取可用模型列表（DeepSeek）
app.get("/api/models", (req, res) => {
  try {
    res.json({
      models: getDeepSeekModels(),
      defaultModel,
    });
  } catch (error: any) {
    console.error("[Models] Error:", error);
    res.json({
      models: getDeepSeekModels(),
      defaultModel,
      error: error?.message || String(error),
    });
  }
});

// ============= 会话 API =============

// 获取所有会话（包含消息数量）
app.get("/api/sessions", (req, res) => {
  try {
    const sessions = db.getAllSessions();
    const sessionsWithMessages = sessions.map(session => {
      const messages = db.getMessagesBySession(session.id);
      return {
        ...session,
        messageCount: messages.length
      };
    });
    res.json({ sessions: sessionsWithMessages });
  } catch (error: any) {
    console.error("[Sessions] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 获取单个会话及其消息
app.get("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }

    const messages = db.getMessagesBySession(sessionId);

    // 解析 tool_calls JSON
    const parsedMessages = messages.map(msg => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
      images: msg.images ? JSON.parse(msg.images) : null,
    }));

    res.json({ session, messages: parsedMessages });
  } catch (error: any) {
    console.error("[Session] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 创建新会话
app.post("/api/sessions", (req, res) => {
  try {
    const { model = defaultModel, title = "新对话" } = req.body;
    const now = new Date().toISOString();

    const session = db.createSession({
      id: uuidv4(),
      title,
      model,
      sdk_session_id: null,
      created_at: now,
      updated_at: now
    });

    res.json({ session });
  } catch (error: any) {
    console.error("[Create Session] Error:", error);
    res.status(500).json({ error: error?.message || "创建会话失败" });
  }
});

// 更新会话
app.patch("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, model } = req.body;

    const success = db.updateSession(sessionId, { title, model });

    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("[Update Session] Error:", error);
    res.status(500).json({ error: error?.message || "更新会话失败" });
  }
});

// 删除会话
app.delete("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = db.deleteSession(sessionId);

    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Session] Error:", error);
    res.status(500).json({ error: error?.message || "删除会话失败" });
  }
});

// ============= 聊天 API =============

// 发送消息并获取流式响应（DeepSeek 函数调用）
app.post("/api/chat", async (req, res) => {
  const { sessionId, message, model, systemPrompt, images } = req.body;

  // 图片校验（视觉模型场景，最多 4 张、单张 ≤5MB 的 data URL）
  let validatedImages: string[] = [];
  try {
    validatedImages = validateImages(images);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "图片校验失败" });
  }

  // 请求日志
  console.log(`\n[Chat] ========== 新请求 ==========`);
  console.log(`[Chat] SessionId: ${sessionId || '(new)'}`);
  console.log(`[Chat] Model: ${model || defaultModel}`);
  console.log(`[Chat] Message: ${message?.slice(0, 100)}${message?.length > 100 ? '...' : ''}`);
  if (validatedImages.length > 0) console.log(`[Chat] Images: ${validatedImages.length} 张`);

  if (!message) {
    console.log(`[Chat] 错误: 消息为空`);
    return res.status(400).json({ error: "消息不能为空" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId) : null;
  const now = new Date().toISOString();

  if (!session) {
    // 创建新会话
    console.log(`[Chat] 创建新会话`);
    session = db.createSession({
      id: sessionId || uuidv4(),
      title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
      model: model || defaultModel,
      sdk_session_id: null,
      created_at: now,
      updated_at: now,
    });
  } else {
    console.log(`[Chat] 使用现有会话: ${session.id}`);
  }

  const selectedModel = model || session.model;

  // 加载历史对话（当前用户消息保存之前的记录）。
  // 历史中的图片不重复发送给模型（成本考虑），以文字备注占位；
  // 仅当前消息的图片会进入多模态消息体。
  const existingMessages = db.getMessagesBySession(session.id);
  const history = existingMessages.map(m => {
    let content = m.content;
    if (m.role === 'user' && m.images) {
      try {
        const imgs = JSON.parse(m.images);
        if (Array.isArray(imgs) && imgs.length > 0) content += `\n[该消息附带 ${imgs.length} 张图片]`;
      } catch { /* 忽略损坏的 images 数据 */ }
    }
    return { role: m.role, content };
  });

  // 创建消息 ID
  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  // 保存用户消息到数据库
  try {
    db.createMessage({
      id: userMessageId,
      session_id: session.id,
      role: 'user',
      content: message,
      model: null,
      created_at: now,
      tool_calls: null,
      images: validatedImages.length > 0 ? JSON.stringify(validatedImages) : null,
    });
    console.log(`[Chat] 用户消息已保存: ${userMessageId}`);
  } catch (dbError: any) {
    console.error(`[Chat] 保存用户消息失败:`, dbError);
    return res.status(500).json({ error: "保存消息失败", detail: dbError?.message });
  }

  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 构建系统提示词：优先用前端传入的（自定义 Agent），否则用客服默认提示词
  const finalSystemPrompt = systemPrompt || buildCustomerServicePrompt(session.id);

  // 发送 init 事件
  res.write(`data: ${JSON.stringify({
    type: "init",
    sessionId: session.id,
    userMessageId,
    assistantMessageId,
    model: selectedModel,
  })}\n\n`);

  // 累积完整回复和工具调用
  let fullResponse = "";
  let lastErrorMessage = "";
  const toolCalls: Array<{
    id: string;
    name: string;
    input?: Record<string, unknown>;
    status: string;
    result?: string;
    isError?: boolean;
  }> = [];

  // 处理客户端断开
  // 注意：req 的 close 事件在请求体读取完成后即触发（Express 解析 JSON 后立即发生），
  // 不能用于断连检测，否则每次对话都会被立刻中止（"Request was aborted"）。
  // res 的 close 才代表连接关闭：配合 writableEnded 区分"提前断开"与"正常结束"。
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      console.log(`[Chat] 客户端断开连接`);
      ac.abort();
    }
  });

  try {
    console.log(`[Chat] 调用 DeepSeek Agent...`);

    await runDeepSeekAgent({
      sessionId: session.id,
      message,
      images: validatedImages.length > 0 ? validatedImages : undefined,
      model: selectedModel,
      systemPrompt: finalSystemPrompt,
      history,
      signal: ac.signal,
      onText: (chunk) => {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: "text", content: chunk })}\n\n`);
      },
      onToolStart: (id, name, input) => {
        console.log(`[Chat] 工具调用: ${name}`, JSON.stringify(input).slice(0, 200));
        toolCalls.push({ id, name, input, status: "running" });
        res.write(`data: ${JSON.stringify({
          type: "tool",
          id,
          name,
          input,
          status: "running",
        })}\n\n`);
      },
      onToolResult: (id, content, isError) => {
        const tool = toolCalls.find(t => t.id === id);
        if (tool) {
          tool.status = isError ? "error" : "completed";
          tool.isError = isError;
          tool.result = content;
        }
        res.write(`data: ${JSON.stringify({
          type: "tool_result",
          toolId: id,
          content,
          isError,
        })}\n\n`);
      },
      onDone: ({ duration, turns }) => {
        console.log(`[Chat] 完成: ${turns} 轮, ${duration}ms`);
        res.write(`data: ${JSON.stringify({ type: "done", duration, turns })}\n\n`);
      },
      onError: (error) => {
        console.error(`[Chat] Agent 错误:`, error.message);
        lastErrorMessage = error.message;
        res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
      },
    });

    // 保存助手消息到数据库（出错且无内容时持久化错误说明，保证刷新后回显一致）
    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content: fullResponse || (lastErrorMessage ? `【对话出错】${lastErrorMessage}` : '(无回复内容)'),
      model: selectedModel,
      created_at: new Date().toISOString(),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
      images: null,
    });

    // 更新会话标题（如果是第一条消息）
    const allMessages = db.getMessagesBySession(session.id);
    if (allMessages.length <= 2) {
      db.updateSession(session.id, {
        title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
        model: selectedModel,
      });
    }

    console.log(`[Chat] 请求完成 ✓`);
    res.end();
  } catch (error: any) {
    console.error(`\n[Chat] ========== 错误 ==========`);
    console.error(`[Chat] Error:`, error?.message);

    // 仍保存已生成的部分回复
    if (fullResponse) {
      try {
        db.createMessage({
          id: assistantMessageId,
          session_id: session.id,
          role: 'assistant',
          content: fullResponse,
          model: selectedModel,
          created_at: new Date().toISOString(),
          tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
          images: null,
        });
      } catch (e) {
        // 忽略保存错误
      }
    }

    const errorMessage = error?.message || "处理请求时发生错误";
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
    res.end();
  }
});

// ============= 管理后台鉴权 =============
// 密码通过 .env 的 ADMIN_PASSWORD 配置；未配置时管理后台与知识库管理 API 整体禁用。
const ADMIN_TOKEN_TTL = 8 * 60 * 60 * 1000; // 登录有效期 8 小时
const adminTokens = new Map<string, number>();

app.post("/api/admin/login", (req, res) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: "管理后台未启用：请在 .env 中配置 ADMIN_PASSWORD 后重启服务" });
  }
  const { password } = req.body || {};
  const a = Buffer.from(String(password || ""));
  const b = Buffer.from(process.env.ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "密码错误" });
  }
  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL);
  for (const [t, e] of adminTokens) if (e < Date.now()) adminTokens.delete(t);
  res.json({ success: true, token, expiresIn: ADMIN_TOKEN_TTL });
});

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(503).json({ error: "管理后台未启用：请在 .env 中配置 ADMIN_PASSWORD 后重启服务" });
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expiresAt = token ? adminTokens.get(token) : undefined;
  if (!expiresAt || expiresAt < Date.now()) {
    if (token) adminTokens.delete(token);
    return res.status(401).json({ error: "未登录或登录已过期" });
  }
  next();
}

// /api/admin/* 与 /api/faq/*（知识库检索/管理）均需管理员登录；登录路由已在上方注册，不受影响
app.use("/api/admin", requireAdmin);
app.use("/api/faq", requireAdmin);

// ============= FAQ 知识库 API =============

// FAQ 关键词+语义混合检索（FAQ 条目 + 文档片段融合）
app.get("/api/faq/search", async (req, res) => {
  try {
    const q = (req.query.q as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
    const results = await searchKnowledge(q, limit);
    res.json({
      query: q,
      count: results.length,
      minScore: getMinScore(),
      semantic: isEmbeddingEnabled(),
      results,
    });
  } catch (error: any) {
    console.error("[FAQ Search] Error:", error);
    res.status(500).json({ error: error?.message || "FAQ 检索失败" });
  }
});

// 列出全部 FAQ（管理后台用）
app.get("/api/faq", (req, res) => {
  try {
    res.json({ ...listAllFaq(), semantic: isEmbeddingEnabled() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取 FAQ 失败" });
  }
});

// ---- 知识库管理（分类） ----

// 新增分类
app.post("/api/faq/categories", (req, res) => {
  try {
    const { name, keywords } = req.body || {};
    const category = addFaqCategory({ name, keywords });
    console.log(`[FAQ Admin] 新增分类: ${category.id} ${category.name}`);
    res.json({ success: true, category });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "新增分类失败" });
  }
});

// 更新分类（名称/关键词）
app.patch("/api/faq/categories/:categoryId", (req, res) => {
  try {
    const { name, keywords } = req.body || {};
    const category = updateFaqCategory(req.params.categoryId, { name, keywords });
    res.json({ success: true, category });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "更新分类失败" });
  }
});

// 删除分类（分类下有条目时拒绝）
app.delete("/api/faq/categories/:categoryId", (req, res) => {
  try {
    deleteFaqCategory(req.params.categoryId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "删除分类失败" });
  }
});

// ---- 知识库管理（条目） ----

// 新增条目
app.post("/api/faq/items", (req, res) => {
  try {
    const { categoryId, question, answer, tags } = req.body || {};
    if (!categoryId) {
      return res.status(400).json({ error: "参数错误：需要 categoryId" });
    }
    const item = addFaqItem(categoryId, { question, answer, tags });
    console.log(`[FAQ Admin] 新增条目: ${item.id}`);
    res.json({ success: true, item });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "新增条目失败" });
  }
});

// 更新条目（内容/标签/所属分类）
app.patch("/api/faq/items/:itemId", (req, res) => {
  try {
    const { question, answer, tags, categoryId } = req.body || {};
    const item = updateFaqItem(req.params.itemId, { question, answer, tags, categoryId });
    res.json({ success: true, item });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "更新条目失败" });
  }
});

// 删除条目
app.delete("/api/faq/items/:itemId", (req, res) => {
  try {
    deleteFaqItem(req.params.itemId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "删除条目失败" });
  }
});

// ---- 知识库文件导入 ----

// CSV 导入模板下载（UTF-8 BOM，Excel 打开中文不乱码）
app.get("/api/faq/import/template", (req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="faq-template.csv"');
  res.send(buildCsvTemplate());
});

// 导入知识库文件（.xlsx / .csv / .md / .json）
app.post("/api/faq/import", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "请上传文件（字段名 file）" });
    }
    const mode = req.body.mode === "replace" ? "replace" : "merge";
    const parsed = await parseImportFile(file.originalname, file.buffer);
    const summary = importFaq(parsed.categories, mode as "merge" | "replace");
    res.json({ success: true, mode, summary });
  } catch (error: any) {
    console.error("[FAQ Admin] 导入失败:", error?.message);
    res.status(400).json({ error: error?.message || "导入失败" });
  }
});

// ============= 文档知识库（路线 B RAG） =============

// 上传文档（.txt / .md / .docx / .pdf，同名替换）
app.post("/api/faq/docs", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "请上传文件（字段名 file）" });
    }
    const doc = await ingestDoc(file.originalname, file.buffer);
    res.json({ success: true, doc });
  } catch (error: any) {
    console.error("[KB Docs] 上传失败:", error?.message);
    res.status(400).json({ error: error?.message || "文档入库失败" });
  }
});

// 文档列表
app.get("/api/faq/docs", (req, res) => {
  try {
    res.json({ docs: listDocs(), semantic: isEmbeddingEnabled() });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取文档列表失败" });
  }
});

// 删除文档（级联删除其所有块）
app.delete("/api/faq/docs/:docId", (req, res) => {
  try {
    const success = deleteDoc(req.params.docId);
    if (!success) return res.status(404).json({ error: "文档不存在" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "删除文档失败" });
  }
});

// ============= 满意度评价 API =============

// 提交评价
app.post("/api/ratings", (req, res) => {
  try {
    const { sessionId, messageId, rating, comment } = req.body;
    if (!sessionId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "参数错误：需要 sessionId 和 1-5 的 rating" });
    }
    const session = db.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    const record = db.upsertRating({
      id: uuidv4(),
      session_id: sessionId,
      message_id: messageId || null,
      rating,
      comment: comment || null,
      created_at: new Date().toISOString(),
    });
    res.json({ success: true, rating: record });
  } catch (error: any) {
    console.error("[Rating] Error:", error);
    res.status(500).json({ error: error?.message || "提交评价失败" });
  }
});

// 获取某会话的所有评价
app.get("/api/ratings/:sessionId", (req, res) => {
  try {
    const ratings = db.getRatingsBySession(req.params.sessionId);
    res.json({ ratings });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取评价失败" });
  }
});

// ============= 转人工 API =============

// 创建转人工事件
app.post("/api/escalate", (req, res) => {
  try {
    const { sessionId, reason, intent } = req.body;
    if (!sessionId || !reason) {
      return res.status(400).json({ error: "参数错误：需要 sessionId 和 reason" });
    }
    const session = db.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    const record = db.createEscalation({
      id: uuidv4(),
      session_id: sessionId,
      reason,
      intent: intent || null,
      created_at: new Date().toISOString(),
    });
    console.log(`[Escalate] 会话 ${sessionId} 已转人工：${reason}`);
    res.json({ success: true, escalation: record });
  } catch (error: any) {
    console.error("[Escalate] Error:", error);
    res.status(500).json({ error: error?.message || "转人工失败" });
  }
});

// 获取某会话的转人工状态（含人工回复数量，供前端检测新回复）
app.get("/api/escalate/:sessionId", (req, res) => {
  try {
    const escalations = db.getEscalationsBySession(req.params.sessionId);
    const humanReplies = db.getMessagesBySession(req.params.sessionId)
      .filter(m => m.model === 'human-agent').length;
    res.json({ escalations, humanReplies });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "获取转人工状态失败" });
  }
});

// 用户留言：转人工后补充联系方式与问题描述
app.post("/api/escalate/note/:escalationId", (req, res) => {
  try {
    const { contact, note } = req.body || {};
    if (!String(contact || '').trim() || !String(note || '').trim()) {
      return res.status(400).json({ error: "请填写联系方式和问题描述" });
    }
    const success = db.updateEscalationNote(req.params.escalationId, String(contact).trim(), String(note).trim());
    if (!success) return res.status(404).json({ error: "转人工记录不存在" });
    console.log(`[Escalate] 用户已留言: ${req.params.escalationId}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "留言失败" });
  }
});

// ============= 会话意图记录 API =============

app.post("/api/intent", (req, res) => {
  try {
    const { sessionId, intent, confidence } = req.body;
    if (!sessionId || !intent) {
      return res.status(400).json({ error: "参数错误：需要 sessionId 和 intent" });
    }
    const session = db.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    const record = db.createSessionIntent({
      session_id: sessionId,
      intent,
      confidence: confidence || null,
    });
    res.json({ success: true, intent: record });
  } catch (error: any) {
    console.error("[Intent] Error:", error);
    res.status(500).json({ error: error?.message || "记录意图失败" });
  }
});

// ============= 管理后台统计 API =============

// 总览统计
app.get("/api/admin/stats", (req, res) => {
  try {
    const ratingStats = db.getRatingStats();
    const intentStats = db.getIntentStats();
    const sessionsWithStats = db.getSessionsWithStats();
    const allEscalations = db.getAllEscalations();

    const totalSessions = sessionsWithStats.length;
    const escalatedSessions = sessionsWithStats.filter(s => s.escalated > 0).length;
    const totalEscalations = allEscalations.length;
    const resolvedEscalations = allEscalations.filter(e => e.status === 'resolved').length;

    res.json({
      overview: {
        totalSessions,
        totalMessages: sessionsWithStats.reduce((sum, s) => sum + s.message_count, 0),
        escalatedSessions,
        escalationRate: totalSessions > 0 ? Math.round((escalatedSessions / totalSessions) * 1000) / 10 : 0,
        totalEscalations,
        resolvedEscalations,
        ratedSessions: sessionsWithStats.filter(s => s.rating !== null).length,
        ratingAverage: ratingStats.average,
        recentRatingAverage: ratingStats.recentAverage,
        totalRatings: ratingStats.total,
      },
      ratingDistribution: ratingStats.distribution,
      intentDistribution: intentStats,
      sessions: sessionsWithStats,
    });
  } catch (error: any) {
    console.error("[Admin Stats] Error:", error);
    res.status(500).json({ error: error?.message || "获取统计失败" });
  }
});

// 后台单会话详情（含消息、评价、转人工、意图）
app.get("/api/admin/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    const messages = db.getMessagesBySession(sessionId).map(msg => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null
    }));
    const ratings = db.getRatingsBySession(sessionId);
    const escalations = db.getEscalationsBySession(sessionId);
    const intents = db.getIntentsBySession(sessionId);
    res.json({ session, messages, ratings, escalations, intents });
  } catch (error: any) {
    console.error("[Admin Session] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话详情失败" });
  }
});

// 人工客服回复：以特殊消息（model=human-agent）写入会话，用户端渲染为人工客服消息；
// 回复即视为已接入，将最新 pending 工单置为 accepted
app.post("/api/admin/sessions/:sessionId/reply", (req, res) => {
  try {
    const { content } = req.body || {};
    const text = String(content || '').trim();
    if (!text) return res.status(400).json({ error: "回复内容不能为空" });
    const session = db.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });
    const message = db.createMessage({
      id: uuidv4(),
      session_id: session.id,
      role: 'assistant',
      content: text,
      model: 'human-agent',
      created_at: new Date().toISOString(),
      tool_calls: null,
      images: null,
    });
    const pending = db.getEscalationsBySession(session.id).filter(e => e.status === 'pending').pop();
    if (pending) db.updateEscalationStatus(pending.id, 'accepted');
    console.log(`[Escalate] 人工回复已写入会话 ${session.id}`);
    res.json({ success: true, message });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "回复失败" });
  }
});

// 更新转人工状态
app.patch("/api/admin/escalations/:id", (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'accepted', 'resolved'].includes(status)) {
      return res.status(400).json({ error: "无效状态" });
    }
    const success = db.updateEscalationStatus(req.params.id, status);
    if (!success) return res.status(404).json({ error: "转人工记录不存在" });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "更新转人工状态失败" });
  }
});

// ============= 生产模式：托管前端构建产物 =============
// npm run build 后 dist/ 存在时，由本服务单端口同时提供 API 与前端页面
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  // SPA 兜底：非 /api 路由统一返回 index.html，交给前端路由处理
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log(`[Static] 托管前端构建产物: ${distDir}`);
}

// ============= 运行时配置（管理后台） =============

// 获取话题边界策略（strict=温和 / open=开放）
app.get("/api/admin/topic-boundary", (req, res) => {
  res.json({ mode: getTopicBoundary() });
});

// 切换话题边界策略（写入 data/config.json，环境变量 TOPIC_BOUNDARY 显式设置时优先）
app.post("/api/admin/topic-boundary", (req, res) => {
  const { mode } = req.body || {};
  if (mode !== 'strict' && mode !== 'open') {
    return res.status(400).json({ error: "无效的话题边界策略（仅支持 strict / open）" });
  }
  setTopicBoundary(mode);
  res.json({ success: true, mode });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║     ◉ LiteRAG 智能客服服务器已启动           ║
║       (DeepSeek 接入)                       ║
║                                            ║
║     地址: http://localhost:${PORT}            ║
║     数据库: SQLite (data/chat.db)          ║
║     FAQ 知识库: server/faq-data.json      ║
║     管理后台: http://localhost:5173/admin  ║
║                                            ║
╚════════════════════════════════════════════╝
  `);
});
