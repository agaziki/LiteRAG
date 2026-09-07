/**
 * 外部渠道桥接（v2.1）：企业微信 / 微信公众号等 webhook 入口
 *
 * 设计：渠道消息以固定渠道标识（channel:<name>:<外部用户ID>）作为 visitor_id
 * 进入现有会话管线——复用 Agent / 知识检索 / 转人工 / 用量统计，零改动复用。
 *
 * 通用入口：POST /api/channels/:channel/message
 *   body: { from: "<外部用户标识>", text: "<用户消息>" }
 *   header: X-Channel-Secret 必须匹配 .env 的 CHANNEL_SECRET
 *   响应：{ reply } —— 同步返回 Agent 回复文本（渠道网关直接透出）
 *
 * 各渠道的签名校验/协议适配（企微回调 URL 验证、公众号 XML/加解密）建议
 * 由独立网关服务完成后，以本通用格式转发。
 */

import express from "express";
import { v4 as uuidv4 } from "uuid";
import * as db from "./db.js";
import { runDeepSeekAgent } from "./deepseek-agent.js";
import { buildCustomerServicePrompt } from "./customer-service-prompt.js";
import { DEFAULT_MODEL } from "./deepseek-agent.js";

/** 渠道会话定位：同一渠道用户复用最近会话（24h 内），否则新建 */
function resolveChannelSession(channelVisitorId: string, model: string): db.DbSession {
  const existing = db.getSessionsByVisitor(channelVisitorId)[0];
  const fresh = existing && Date.now() - new Date(existing.updated_at).getTime() < 24 * 3600 * 1000;
  if (fresh) return existing;
  const now = new Date().toISOString();
  return db.createSession({
    id: uuidv4(),
    title: "渠道咨询",
    model,
    sdk_session_id: null,
    created_at: now,
    updated_at: now,
    visitor_id: channelVisitorId,
  });
}

export function channelRouter(): express.Router {
  const router = express.Router();

  router.post("/:channel/message", async (req, res) => {
    try {
      const secret = process.env.CHANNEL_SECRET;
      if (!secret) {
        return res.status(503).json({ error: "渠道接入未启用：请配置 CHANNEL_SECRET" });
      }
      if (req.headers["x-channel-secret"] !== secret) {
        return res.status(401).json({ error: "渠道密钥不匹配" });
      }
      const channel = String(req.params.channel || "generic").replace(/[^\w-]/g, "");
      const from = String(req.body?.from || "").trim();
      const text = String(req.body?.text || "").trim();
      if (!from || !text) {
        return res.status(400).json({ error: "需要 from 与 text" });
      }

      const visitorId = `channel:${channel}:${from}`;
      const session = resolveChannelSession(visitorId, DEFAULT_MODEL);

      // 沿用主链路：历史 → Agent → 回复
      const existingMessages = db.getMessagesLite(session.id);
      const history = existingMessages.map(m => ({ role: m.role, content: m.content }));
      let reply = "";
      await runDeepSeekAgent({
        sessionId: session.id,
        message: text,
        model: DEFAULT_MODEL,
        systemPrompt: buildCustomerServicePrompt(session.id),
        history,
        onText: chunk => { reply += chunk; },
        onToolStart: () => {},
        onToolResult: () => {},
        onDone: () => {},
        onError: err => { reply = reply || `抱歉，处理您的请求时出错：${err.message}`; },
      });

      res.json({ reply: reply || "（无回复内容）" });
    } catch (error: any) {
      console.error("[Channel] 处理失败:", error?.message);
      res.status(500).json({ error: error?.message || "渠道消息处理失败" });
    }
  });

  return router;
}
