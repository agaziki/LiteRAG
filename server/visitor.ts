/**
 * 访客身份体系（v2.0 多租户地基）
 *
 * 设计：匿名访客自动签发 visitorId（httpOnly cookie，1 年有效），
 * 无需登录即可隔离会话——每个访客只能看到/操作自己的会话。
 * 管理员（ADMIN_PASSWORD 登录）不受限制，可查看全部会话。
 *
 * 升级路径：visitorId 与未来注册用户绑定（user_id 列）即可平滑过渡到账号体系。
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "literag_vid";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 年

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** 从请求解析访客身份（无 cookie 则签发新 ID，由 ensureVisitor 写回） */
export function getVisitorId(req: Request): string {
  const vid = parseCookies(req)[COOKIE_NAME];
  return vid && /^[0-9a-f-]{36}$/i.test(vid) ? vid : crypto.randomUUID();
}

/** 确保请求携带访客身份：无则签发并 Set-Cookie；req.visitorId 供路由使用 */
export function ensureVisitor(req: Request, res: Response, next: NextFunction): void {
  (req as any).visitorId = getVisitorId(req);
  const existing = parseCookies(req)[COOKIE_NAME];
  if (existing !== (req as any).visitorId) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${(req as any).visitorId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE / 1000}`
    );
  }
  next();
}

/** 是否管理员请求（复用 adminTokens 的校验逻辑由 index.ts 注入） */
export function setAdminCheck(fn: (req: Request) => boolean): void {
  adminCheck = fn;
}
let adminCheck: (req: Request) => boolean = () => false;

/** 会话所有权守卫：管理员放行；否则校验会话归属当前访客 */
export function requireOwnership(req: Request, res: Response, next: NextFunction): void {
  if (adminCheck(req)) return next();
  const owner = (req as any).sessionOwnerId;
  if (owner && owner === (req as any).visitorId) return next();
  res.status(403).json({ error: "无权访问该会话" });
}
