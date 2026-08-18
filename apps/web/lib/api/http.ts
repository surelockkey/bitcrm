import type { ApiResponse, PaginatedResponse } from "@bitcrm/types";
import { env } from "@/lib/env";
import { ApiError } from "./errors";

/**
 * The backend authenticates with the Cognito **id token** as a Bearer token
 * (services verify `tokenUse: "id"`). The token is supplied at runtime by the
 * auth layer via {@link setAuthTokenProvider} to keep this module decoupled
 * from the store (no import cycle).
 */
type TokenProvider = () => string | null | undefined;

let getToken: TokenProvider = () => null;
let onUnauthorized: (() => void) | null = null;
/** Renews the session and resolves true when a fresh token is available. */
let refreshSession: (() => Promise<boolean>) | null = null;
/** One renewal at a time — a page mid-load fires a dozen requests at once. */
let refreshing: Promise<boolean> | null = null;

export function setAuthTokenProvider(fn: TokenProvider): void {
  getToken = fn;
}

/**
 * How the client renews an expired session.
 *
 * Cognito id tokens last an hour. Without this, everything kept working from
 * the query cache while every request 401'd — the page still looked signed in,
 * and saving anything failed. Worse, the 401 handler clears the session, so the
 * request after that went out with no token at all.
 */
export function setSessionRefresher(fn: () => Promise<boolean>): void {
  refreshSession = fn;
}

function renewOnce(): Promise<boolean> {
  refreshing ??= (refreshSession?.() ?? Promise.resolve(false)).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

function buildHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers);
  // Let the browser set the multipart boundary for FormData bodies.
  if (
    !headers.has("Content-Type") &&
    init.body &&
    !(init.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/** The auth calls themselves must never try to renew a session to run. */
function isAuthPath(path: string): boolean {
  return path.startsWith("/users/auth/");
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      headers: buildHeaders(init),
    });
  } catch {
    // Network failure / server unreachable — surface a clean message.
    throw new ApiError(
      0,
      "Unable to reach the server. Please check your connection and try again.",
    );
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);

  // An expired token is the ordinary end of an hour's work, not a sign-out.
  // Renew once and replay the request; only a failed renewal ends the session.
  if (res.status === 401 && !isAuthPath(path) && (await renewOnce())) {
    res = await send(path, init);
  }

  const body: unknown = await res.json().catch(() => null);

  if (res.status === 401) onUnauthorized?.();

  if (!res.ok || !isSuccess(body)) {
    throw new ApiError(
      res.status,
      extractMessage(body) ?? res.statusText ?? "Request failed",
      body,
    );
  }

  return body as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Reads an error message from common shapes: {message}, {message:[]}, {error},
 * and our API error envelope {error:{code, message}}.
 */
function extractMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const { message, error } = body;
  if (typeof message === "string" && message) return message;
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === "string");
    if (parts.length) return parts.join(", ");
  }
  if (typeof error === "string" && error) return error;
  // Backend envelope: { success:false, error:{ code, message } }
  if (isRecord(error)) {
    const nested = error.message;
    if (typeof nested === "string" && nested) return nested;
    if (Array.isArray(nested)) {
      const parts = nested.filter((m): m is string => typeof m === "string");
      if (parts.length) return parts.join(", ");
    }
  }
  return null;
}

function isSuccess(v: unknown): boolean {
  return isRecord(v) && v.success === true;
}

/** Unwraps the `{ success, data }` envelope and returns `data`. */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const body = await request<ApiResponse<T>>(path, init);
  return body.data;
}

/** Returns the full paginated envelope (`data` + `pagination` cursor). */
export async function apiFetchPaginated<T>(
  path: string,
  init?: RequestInit,
): Promise<PaginatedResponse<T>> {
  return request<PaginatedResponse<T>>(path, init);
}

/** Convenience helpers. Bodies are JSON-serialized automatically. */
export const http = {
  get: <T>(path: string) => apiFetch<T>(path),
  getPaginated: <T>(path: string) => apiFetchPaginated<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  postForm: <T>(path: string, form: FormData) =>
    apiFetch<T>(path, { method: "POST", body: form }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
