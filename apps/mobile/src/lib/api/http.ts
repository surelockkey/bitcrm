import { env } from '../env';
import { ApiError } from './errors';

/**
 * The backend authenticates with the Cognito **id token** as a Bearer token
 * (services verify `tokenUse: "id"`). The token is supplied at runtime by the
 * auth layer via {@link setAuthTokenProvider} to keep this module decoupled
 * from the auth store (no import cycle).
 */
type TokenProvider = () => string | null | undefined;

/**
 * Exchanges the stored refresh token for a fresh id token. Resolves true when
 * the session was renewed, false when it is really over. Registered by the auth
 * layer for the same reason as the token provider.
 */
type TokenRefresher = () => Promise<boolean>;

let getToken: TokenProvider = () => null;
let onUnauthorized: (() => void) | null = null;
let refreshTokens: TokenRefresher | null = null;

export function setAuthTokenProvider(fn: TokenProvider): void {
  getToken = fn;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function setTokenRefresher(fn: TokenRefresher | null): void {
  refreshTokens = fn;
}

/**
 * One refresh at a time.
 *
 * The job screen fires several requests at once (the job, its timeline, its
 * attachments). An expired token 401s all of them within the same tick, and
 * without this they would each burn the refresh token — Cognito rotates it, so
 * the second exchange fails and signs out a technician whose session was fine.
 */
let inFlightRefresh: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!refreshTokens) return false;
  if (!inFlightRefresh) {
    inFlightRefresh = refreshTokens()
      .catch(() => false)
      .finally(() => {
        inFlightRefresh = null;
      });
  }
  return inFlightRefresh;
}

/** Response envelope every BitCRM controller returns. */
interface Envelope<T> {
  success: true;
  data: T;
  pagination?: Pagination;
}

export interface Pagination {
  nextCursor?: string;
  count?: number;
}

export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

interface ApiRequestInit extends RequestInit {
  /** Set on the refresh call itself, so a failed refresh cannot recurse. */
  skipAuthRefresh?: boolean;
}

function buildHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

interface RawResponse {
  status: number;
  statusText: string;
  ok: boolean;
  body: unknown;
}

async function send(path: string, init: ApiRequestInit): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      headers: buildHeaders(init),
    });
  } catch {
    throw new ApiError(
      0,
      'Unable to reach the server. Please check your connection and try again.',
    );
  }
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, statusText: res.statusText, ok: res.ok, body };
}

/**
 * One request, with a single transparent token refresh on 401.
 *
 * A technician's shift outlives an id token, and being thrown back to the login
 * screen mid-job is the worst possible moment. So a 401 buys one refresh and
 * one retry; only a second 401 — or a refresh the server refuses — actually
 * ends the session (docs/ARCHITECTURE.md §2.5).
 */
async function requestEnvelope<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<Envelope<T>> {
  let attempt = await send(path, init);

  if (attempt.status === 401 && !init.skipAuthRefresh) {
    const renewed = await refreshOnce();
    if (renewed) attempt = await send(path, init);
  }

  if (attempt.status === 401) onUnauthorized?.();

  if (!attempt.ok || !isSuccess(attempt.body)) {
    throw new ApiError(
      attempt.status,
      extractMessage(attempt.body) ?? attempt.statusText ?? 'Request failed',
      attempt.body,
    );
  }

  return attempt.body as Envelope<T>;
}

async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  return (await requestEnvelope<T>(path, init)).data;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Reads an error message from common shapes: {message}, {message:[]}, {error}. */
function extractMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const { message, error } = body;
  if (typeof message === 'string' && message) return message;
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === 'string');
    if (parts.length) return parts.join(', ');
  }
  if (typeof error === 'string' && error) return error;
  // nginx answers a dead upstream with { error: { code, message } }.
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return null;
}

function isSuccess(v: unknown): boolean {
  return isRecord(v) && v.success === true;
}

const json = (body: unknown) => JSON.stringify(body ?? {});

/** Convenience helpers. Bodies are JSON-serialized; responses are unwrapped. */
export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: json(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: json(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: json(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** POST that must not trigger a token refresh — the refresh call itself. */
  postWithoutRefresh: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: json(body), skipAuthRefresh: true }),
  /**
   * A list endpoint: keeps `pagination` alongside `data`, which the plain
   * helpers throw away. Cursor paging is the only way to read a technician's
   * jobs — the list has no date filter (docs/ARCHITECTURE.md §1.2).
   */
  paginated: async <T>(path: string): Promise<Page<T>> => {
    const envelope = await requestEnvelope<T[]>(path);
    return {
      data: Array.isArray(envelope.data) ? envelope.data : [],
      pagination: envelope.pagination ?? {},
    };
  },
};
