import { env } from '../env';
import { ApiError } from './errors';

/**
 * The backend authenticates with the Cognito **id token** as a Bearer token
 * (services verify `tokenUse: "id"`). The token is supplied at runtime by the
 * auth layer via {@link setAuthTokenProvider} to keep this module decoupled
 * from the auth store (no import cycle).
 */
type TokenProvider = () => string | null | undefined;

let getToken: TokenProvider = () => null;
let onUnauthorized: (() => void) | null = null;

export function setAuthTokenProvider(fn: TokenProvider): void {
  getToken = fn;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

  if (res.status === 401) onUnauthorized?.();

  if (!res.ok || !isSuccess(body)) {
    throw new ApiError(
      res.status,
      extractMessage(body) ?? res.statusText ?? 'Request failed',
      body,
    );
  }

  return (body as { data: T }).data;
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
  return null;
}

function isSuccess(v: unknown): boolean {
  return isRecord(v) && v.success === true;
}

/** Convenience helpers. Bodies are JSON-serialized; responses are unwrapped. */
export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
};
