/**
 * REST client for the DRS backend — the mobile counterpart of drs/src/api/client.js,
 * with the same contract: bearer token in the Authorization header, non-2xx throws an
 * ApiError carrying the status and the server's message.
 *
 * There is exactly ONE authentication system in DRS (spec §17): this attaches the JWT
 * minted by `POST /api/auth/login`. Nothing here invents a second one.
 *
 * The token is held in memory by this module and mirrored to the keystore by the auth
 * context. In-memory is the source of truth for requests so no async keystore read sits
 * in the path of every call.
 */
import { getApiBase } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('api');

/** Request timeout. Long enough for a cold Postgres query, short enough to fail visibly. */
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  readonly status: number;
  /** Machine-readable reason, e.g. 'account_blocked'. Absent on most errors. */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** A status of 0 means the request never reached the backend. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/**
 * Codes the backend's RequireAuth middleware returns when a still-cryptographically-
 * valid JWT must be rejected: the account was blocked or deleted, its role changed, or
 * the token expired. Any of these means the session is over and re-login is the only
 * path forward.
 *
 * This list matches SESSION_REVOKED_CODES in the dashboard exactly. A plain 401 that is
 * NOT one of these (a wrong current password on the change-password form, say) must not
 * sign anyone out.
 */
const SESSION_REVOKED_CODES = new Set([
  'account_blocked',
  'account_deleted',
  'role_changed',
  'token_invalid',
]);

export type RevocationCode = 'account_blocked' | 'account_deleted' | 'role_changed' | 'token_invalid';

let token: string | null = null;
let onRevoked: ((code: RevocationCode) => void) | null = null;

export function setAuthToken(next: string | null): void {
  token = next;
}

export function getAuthToken(): string | null {
  return token;
}

/**
 * onSessionRevoked registers the single handler the auth context uses to tear the
 * session down. It fires from ANY request that comes back revoked, not just a
 * background poll, so the "signed out for security" state appears immediately.
 */
export function onSessionRevoked(handler: ((code: RevocationCode) => void) | null): void {
  onRevoked = handler;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Set false for the public endpoints (login, register) so no stale token is sent. */
  auth?: boolean;
  signal?: AbortSignal;
};

/**
 * apiFetch is the single request path. `path` is relative to the API base and includes
 * the /api prefix, e.g. '/api/devices'.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Own timeout, linked to any caller-supplied signal. React Native's fetch has no
  // timeout at all, so without this a request against an unreachable host hangs until
  // the OS gives up — which on a mobile network can be well over a minute.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // A caller-driven abort is not a failure to report — it means the screen unmounted.
    if (signal?.aborted) {
      throw new ApiError('Request cancelled', 0);
    }
    log.warn(`${method} ${path} failed to reach the backend`, err);
    throw new ApiError('Cannot reach the DRS backend. Check the server address and your network.', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; code?: string };
    const code = payload.code;

    if (response.status === 401 && auth && token && code && SESSION_REVOKED_CODES.has(code)) {
      token = null;
      onRevoked?.(code as RevocationCode);
    }
    throw new ApiError(payload.error || `Request failed (${response.status})`, response.status, code);
  }

  return data as T;
}
