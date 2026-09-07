/**
 * 用户账号工具（v2.1）：token 存 localStorage；authedFetch 自动携带凭证，
 * 使会话归属解析为 uid:<userId>（跨设备同步）。
 */

const STORAGE_KEY = 'userToken';

export function getUserToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setUserToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearUserToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isUserLoggedIn(): boolean {
  return !!getUserToken();
}

/** 用户级 fetch：自动携带 Authorization；用于会话/消息/评价/转人工等接口 */
export async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getUserToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
