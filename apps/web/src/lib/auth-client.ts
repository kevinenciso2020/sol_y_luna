/**
 * Browser auth client. The access token lives only in this module's memory (never in
 * localStorage/sessionStorage). The refresh token is an httpOnly cookie the script cannot read.
 */
import type { AuthSessionResponse, AuthUserDto } from '@sol-y-luna/shared';

let accessToken: string | null = null;
let currentUser: AuthUserDto | null = null;
let refreshing: Promise<boolean> | null = null;

const CSRF_HEADER = { 'x-syl-csrf': '1' };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
    public readonly details: { path: (string | number)[]; message: string }[] = [],
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const data = (await res.json()) as {
      error?: {
        message?: string;
        code?: string;
        details?: { path: (string | number)[]; message: string }[];
      };
    };
    return new ApiError(
      res.status,
      data.error?.message ?? 'Algo salió mal. Intenta de nuevo.',
      data.error?.code ?? 'ERROR',
      data.error?.details ?? [],
    );
  } catch {
    return new ApiError(res.status, 'Algo salió mal. Intenta de nuevo.', 'ERROR');
  }
}

function storeSession(session: AuthSessionResponse) {
  accessToken = session.accessToken;
  currentUser = session.user;
}

/** Single-flight refresh: concurrent callers share one rotation (avoids false reuse detection). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: CSRF_HEADER,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        accessToken = null;
        currentUser = null;
        return false;
      }
      storeSession((await res.json()) as AuthSessionResponse);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** fetch() against the BFF with the in-memory access token; refreshes once on 401. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = () => {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return fetch(path, { ...init, headers, credentials: 'same-origin' });
  };

  if (!accessToken) await refreshSession();
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** POST without auth (login, register, recovery). */
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export async function login(input: { email: string; password: string; turnstileToken?: string }) {
  const session = await publicPost<AuthSessionResponse>('/api/auth/login', input);
  storeSession(session);
  return session.user;
}

export async function logout() {
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: CSRF_HEADER,
    credentials: 'same-origin',
  }).catch(() => {});
  accessToken = null;
  currentUser = null;
}

export const getCurrentUser = () => currentUser;
