const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

let accessToken: string | null = localStorage.getItem('np_access');
let refreshToken: string | null = localStorage.getItem('np_refresh');
let refreshPromise: Promise<boolean> | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('np_access', access);
  localStorage.setItem('np_refresh', refresh);
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('np_access');
  localStorage.removeItem('np_refresh');
}

export const getAccessToken = () => accessToken;
export const getRefreshToken = () => refreshToken;

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setTokens(data.accessToken, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
  retry?: boolean;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true, retry = true, headers, ...rest } = options;
  const finalHeaders: Record<string, string> = {
    accept: 'application/json',
    ...(headers as Record<string, string> | undefined),
  };
  if (body !== undefined && !(body instanceof FormData)) finalHeaders['content-type'] = 'application/json';
  if (auth && accessToken) finalHeaders.authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  if (res.status === 401 && auth && retry && (await tryRefresh())) {
    return api<T>(path, { ...options, retry: false });
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401 && auth) clearTokens();
    throw new ApiError(
      res.status,
      data?.error ?? 'error',
      data?.message ?? `Request failed (${res.status})`,
      data?.details
    );
  }
  return data as T;
}

/** authenticated CSV download — returns object URL */
export async function downloadCsv(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'export_failed', 'Export failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** public checkout API (no auth) */
export function publicApi<T = unknown>(path: string): Promise<T> {
  return api<T>(path, { auth: false });
}
