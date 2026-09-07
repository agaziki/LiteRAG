/**
 * 实时人工会话（v2.0）
 *
 * WebSocket 双向通道：
 *   - 坐席端（管理后台）：/ws/agent?token=<ADMIN 登录 token>
 *       订阅转人工会话流；可向指定会话实时发送人工消息
 *   - 用户端：复用现有 HTTP 轮询拉取人工回复（20s），实时性由坐席端发送时
 *     通过 SSE/轮询的 refreshKey 机制触发刷新；后续可升级用户端 WS
 *
 * 协议（坐席端 JSON 消息）：
 *   上行：{ type: "reply", sessionId, content }
 *         { type: "accept", sessionId }        —— 接入（pending → accepted）
 *         { type: "resolve", sessionId }
 *   下行：{ type: "pending", sessions: [...] }  —— 当前待接入会话列表
 *         { type: "replied", sessionId, message } —— 回复已写入确认
 *         { type: "error", message }
 *
 * 人工消息仍以 model=human-agent 落库，与既有渲染/轮询完全兼容。
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { v4 as uuidv4 } from "uuid";
import * as db from "./db.js";

interface AgentConn {
  ws: WebSocket;
  token: string;
}

const agents = new Set<AgentConn>();

/** 校验管理员 token（由 index.ts 注入，复用 adminTokens） */
let validateToken: (token: string) => boolean = () => false;
export function setTokenValidator(fn: (token: string) => boolean): void {
  validateToken = fn;
}

export function broadcastPending(): void {
  const rows = db.getEscalationsBySessionAll();
  const pending = rows
    .filter(e => e.status === "pending")
    .map(e => ({
      sessionId: e.session_id,
      escalationId: e.id,
      reason: e.reason,
      intent: e.intent,
      created_at: e.created_at,
      contact: e.contact ?? null,
      note: e.note ?? null,
    }));
  const payload = JSON.stringify({ type: "pending", sessions: pending });
  for (const conn of agents) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(payload);
  }
}

function handleAgentMessage(conn: AgentConn, raw: string): void {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    conn.ws.send(JSON.stringify({ type: "error", message: "消息必须是 JSON" }));
    return;
  }

  if (msg.type === "reply") {
    const sessionId = String(msg.sessionId || "");
    const content = String(msg.content || "").trim();
    if (!sessionId || !content) {
      conn.ws.send(JSON.stringify({ type: "error", message: "reply 需要 sessionId 与 content" }));
      return;
    }
    const session = db.getSession(sessionId);
    if (!session) {
      conn.ws.send(JSON.stringify({ type: "error", message: "会话不存在" }));
      return;
    }
    const message = db.createMessage({
      id: uuidv4(),
      session_id: sessionId,
      role: "assistant",
      content,
      model: "human-agent",
      created_at: new Date().toISOString(),
      tool_calls: null,
      images: null,
    });
    const pending = db.getEscalationsBySession(sessionId).filter(e => e.status === "pending").pop();
    if (pending) db.updateEscalationStatus(pending.id, "accepted");
    conn.ws.send(JSON.stringify({ type: "replied", sessionId, message: { id: message.id, content } }));
    broadcastPending();
    return;
  }

  if (msg.type === "accept" || msg.type === "resolve") {
    const sessionId = String(msg.sessionId || "");
    const escalations = db.getEscalationsBySession(sessionId);
    // accept 取最新 pending；resolve 可对已接入（accepted）或排队中（pending）的工单操作
    const target = msg.type === "accept"
      ? escalations.filter(e => e.status === "pending").pop()
      : escalations.filter(e => e.status === "accepted" || e.status === "pending").pop();
    if (target) {
      db.updateEscalationStatus(target.id, msg.type === "accept" ? "accepted" : "resolved");
      broadcastPending();
    } else {
      conn.ws.send(JSON.stringify({ type: "error", message: "没有可处理的转人工工单" }));
    }
    return;
  }

  conn.ws.send(JSON.stringify({ type: "error", message: `未知消息类型: ${msg.type}` }));
}

export function attachRealtime(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/ws/agent" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://localhost");
    const token = url.searchParams.get("token") || "";
    if (!validateToken(token)) {
      ws.close(4001, "未授权");
      return;
    }
    const conn: AgentConn = { ws, token };
    agents.add(conn);
    // 连接建立后异步广播当前待接入列表（等待客户端挂载 message 监听）
    setImmediate(() => broadcastPending());

    ws.on("message", raw => handleAgentMessage(conn, raw.toString()));
    ws.on("close", () => agents.delete(conn));
    ws.on("error", () => agents.delete(conn));
  });

  console.log("[Realtime] 坐席 WebSocket 通道已挂载: /ws/agent");
}
