/**
 * 管理后台鉴权工具：token 存 localStorage，请求自动附加 Bearer 头。
 * 401 时清除凭证（调用方据此回退到登录页）。
 */

const STORAGE_KEY = 'adminToken';

export function getAdminToken(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** 管理接口专用 fetch：自动附加 Authorization；返回原始 Response 供调用方处理 401 */
export async function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

/** 若响应为 401，清除凭证并返回 true（调用方应中断流程并回到登录页） */
export function handleAuthExpired(res: Response): boolean {
  if (res.status === 401) {
    clearAdminToken();
    return true;
  }
  return false;
}
