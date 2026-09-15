/**
 * The internal HTTP clients under `outbound/internal/` call peer services
 * with a bare `fetch` + `x-internal-secret`, like telephony's read-side
 * services. The function is injected under this token so unit tests (and
 * the e2e harness, which must never make a network call) can hand in a fake;
 * when nothing is provided the global `fetch` is used.
 */
export const INTERNAL_FETCH = Symbol('INTERNAL_FETCH');

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const defaultFetch: FetchLike = (input, init) => fetch(input, init);
