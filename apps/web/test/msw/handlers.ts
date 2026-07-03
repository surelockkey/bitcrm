import { http, HttpResponse } from "msw";

/** Canonical token payload (LoginResponse / ChangePasswordResponse shape). */
export const TOKENS = {
  accessToken: "access-tok",
  refreshToken: "refresh-tok",
  idToken: "id-tok",
  expiresIn: 3600,
};

/**
 * Default handlers model the real backend semantics. Tests override per-case
 * with `server.use(...)`. Wildcard origins so they match any API base URL.
 *
 * Conventions used by tests:
 *  - login password "temp-pass"  → NEW_PASSWORD_REQUIRED challenge
 *  - login password "wrong"      → 401 invalid credentials
 *  - change-password session "expired" → 401 expired session
 *  - reset confirm code "000000" → 401 invalid/expired code
 */
export const handlers = [
  http.post("*/users/auth/login", async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password === "wrong") {
      return HttpResponse.json(
        { success: false, message: "Invalid email or password" },
        { status: 401 },
      );
    }
    if (body.password === "temp-pass") {
      return HttpResponse.json({
        success: true,
        data: { challengeName: "NEW_PASSWORD_REQUIRED", session: "sess-123" },
      });
    }
    return HttpResponse.json({ success: true, data: TOKENS });
  }),

  http.post("*/users/auth/change-password", async ({ request }) => {
    const body = (await request.json()) as { session: string };
    if (body.session === "expired") {
      return HttpResponse.json(
        { success: false, message: "Invalid or expired session" },
        { status: 401 },
      );
    }
    return HttpResponse.json({ success: true, data: TOKENS });
  }),

  http.post("*/users/auth/password-reset", async () => {
    return HttpResponse.json({
      success: true,
      data: { message: "If the account exists, a reset code has been sent." },
    });
  }),

  http.post("*/users/auth/password-reset/confirm", async ({ request }) => {
    const body = (await request.json()) as { code: string };
    if (body.code === "000000") {
      return HttpResponse.json(
        { success: false, message: "Invalid or expired reset code" },
        { status: 401 },
      );
    }
    return HttpResponse.json({
      success: true,
      data: { message: "Password has been reset." },
    });
  }),
];
