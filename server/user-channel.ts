/**
 * 用户端实时推送（v2.1）
 *
 * 与坐席通道 /ws/agent 对应的用户通道 /ws/user?sessionId=<id>：
 * 有人工回复写入该会话时，实时推送给正打开该会话的用户，
 * 替代此前的 20 秒轮询（轮询作为 WS 不可用时的兜底仍保留）。
 *
 * 推送消息：{ type: "human_reply", sessionId, content, created_at }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import * as db from "./db.js";

/** sessionId → 打开中的用户连接集合 */
const userConns = new Map<string, Set<WebSocket>>();

export function notifyHumanReply(sessionId: string, content: string, createdAt: string): void {
  const conns = userConns.get(sessionId);
  if (!conns) return;
  const payload = JSON.stringify({ type: "human_reply", sessionId, content, created_at: createdAt });
  for (const ws of conns) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

let userWss: WebSocketServer | null = null;

/** 供 index.ts 的统一 upgrade 监听分发 /ws/user */
export function handleUserUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  userWss?.handleUpgrade(req, socket, head, ws => userWss!.emit("connection", ws, req));
}

export function attachUserChannel(): void {
  const wss = new WebSocketServer({ noServer: true });
  userWss = wss;

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", "http://localhost");
    const sessionId = url.searchParams.get("sessionId") || "";
    const session = sessionId ? db.getSession(sessionId) : undefined;
    if (!session) {
      ws.close(4002, "会话不存在");
      return;
    }
    let set = userConns.get(sessionId);
    if (!set) {
      set = new Set();
      userConns.set(sessionId, set);
    }
    set.add(ws);

    const cleanup = () => {
      const s = userConns.get(sessionId);
      if (s) {
        s.delete(ws);
        if (s.size === 0) userConns.delete(sessionId);
      }
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });
}
