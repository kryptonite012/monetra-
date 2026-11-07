/**
 * Browser API client.
 * - The access token lives only in memory (never localStorage) to limit XSS impact.
 * - The refresh token is an httpOnly, SameSite=Strict cookie the browser sends to /api/v1/auth.
 * - Expired access tokens are refreshed once (single-flight) and the request retried.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Field-level messages from a 422 validation error, keyed by field path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message]));
  }
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

async function csrfToken(): Promise<string> {
  const existing = readCookie('monetra_csrf');
  if (existing) return existing;
  const res = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
  const body = await res.json();
  return body.data.csrfToken;
}

/** Exchanges the refresh cookie for a new access token. Returns null if the session has ended. */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': await csrfToken() },
      });
      if (res.ok) {
        const body = await res.json();
        accessToken = body.data.accessToken;
        return accessToken;
      }
      // Another tab rotated the token a moment ago: retry once with the updated cookie.
      if (res.status === 409) continue;
      // Rate limiting or a server/network hiccup is not a sign-out: keep the session and surface an error.
      if (res.status === 429 || res.status >= 500) {
        throw new ApiError(res.status, res.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR', res.status === 429 ? 'Too many requests. Please wait a moment.' : 'The server is unavailable. Please try again.');
      }
      break;
    }
    accessToken = null;
    return null;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (path === '/auth/logout' || path === '/auth/refresh') headers['X-CSRF-Token'] = await csrfToken();

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/login') && path !== '/auth/refresh') {
    const token = await refreshSession().catch((err: ApiError) => {
      throw err;
    });
    if (token) return request<T>(method, path, body, false);
    onSessionExpired?.();
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json.error ?? {};
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Something went wrong', err.details);
  }
  return json as T;
}

/** Unwraps `{ data }` responses. */
export const api = {
  get: <T>(path: string) => request<{ data: T }>('GET', path).then((r) => r.data),
  page: <T>(path: string) => request<{ data: T; meta: Record<string, any> }>('GET', path),
  post: <T>(path: string, body?: unknown) => request<{ data: T } | undefined>('POST', path, body ?? {}).then((r) => (r as { data: T } | undefined)?.data as T),
  put: <T>(path: string, body?: unknown) => request<{ data: T }>('PUT', path, body ?? {}).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) => request<{ data: T }>('PATCH', path, body ?? {}).then((r) => r.data),
  delete: <T = void>(path: string, body?: unknown) => request<{ data: T } | undefined>('DELETE', path, body).then((r) => (r as { data: T } | undefined)?.data as T),
  upload: <T>(path: string, form: FormData) => request<{ data: T }>('POST', path, form).then((r) => r.data),
};

/** Downloads a protected file (reports, exports, receipts) with the current access token. */
export async function downloadFile(path: string, fallbackName: string) {
  const go = async () =>
    fetch(`/api/v1${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, credentials: 'same-origin' });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'Could not download the file');
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** SWR fetcher for `{ data }` endpoints. */
export const fetcher = <T,>(path: string) => api.get<T>(path);
