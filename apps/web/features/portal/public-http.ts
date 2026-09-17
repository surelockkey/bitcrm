import { env } from "@/lib/env";
import { PublicApiError, unwrapEnvelope } from "./lib";

export { PublicApiError };

/**
 * Minimal client for the public (token-authenticated) portal endpoints.
 *
 * Deliberately separate from `lib/api/http`: that client attaches the staff
 * member's Cognito token, tries to renew the session on 401 and clears it on
 * failure — none of which may happen on a client-facing page (a staff member
 * opening a client's link must not be signed out, and no credentials leak
 * into the request).
 */
export async function publicGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new PublicApiError(0, "Unable to reach the server. Please check your connection and try again.");
  }
  const body: unknown = await res.json().catch(() => null);
  const result = unwrapEnvelope<T>(body);
  if (!res.ok || !result.ok) {
    throw new PublicApiError(
      res.status,
      (!result.ok && result.message) || res.statusText || "Request failed",
      result.ok ? undefined : result.businessName,
    );
  }
  return result.data;
}
