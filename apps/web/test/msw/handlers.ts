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
 *  - login password "mfa-pass"   → SMS_MFA challenge (session "mfa-1", •••• 1234)
 *  - mfa code "123456"           → tokens; any other code → 401
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
    if (body.password === "mfa-pass") {
      return HttpResponse.json({
        success: true,
        data: { challengeName: "SMS_MFA", session: "mfa-1", destination: "•••• 1234" },
      });
    }
    // Security Center "Login sending options": the code may go by email too.
    if (body.password === "mfa-email-pass") {
      return HttpResponse.json({
        success: true,
        data: { challengeName: "SMS_MFA", session: "mfa-1", destination: "•••• 1234", emailDestination: "b•••@x.com" },
      });
    }
    // The account requires two-factor authentication and this person has no phone.
    if (body.password === "setup-pass") {
      return HttpResponse.json({
        success: true,
        data: { challengeName: "MFA_SETUP", session: "setup-1" },
      });
    }
    if (body.password === "temp-pass") {
      return HttpResponse.json({
        success: true,
        data: { challengeName: "NEW_PASSWORD_REQUIRED", session: "sess-123" },
      });
    }
    return HttpResponse.json({ success: true, data: TOKENS });
  }),

  http.post("*/users/auth/mfa", async ({ request }) => {
    const body = (await request.json()) as { session: string; code: string };
    if (body.code !== "123456") {
      return HttpResponse.json({ success: false, message: "That code is not right." }, { status: 401 });
    }
    return HttpResponse.json({ success: true, data: TOKENS });
  }),

  http.post("*/users/auth/mfa/resend", async () =>
    HttpResponse.json({ success: true, data: { destination: "•••• 1234" } }),
  ),

  // The phone given on the way in (MFA_SETUP): "5412830000" is a teammate's.
  http.post("*/users/auth/mfa/setup", async ({ request }) => {
    const body = (await request.json()) as { session: string; phone: string };
    const digits = body.phone.replace(/\D/g, "");
    if (digits.endsWith("5412830000")) {
      return HttpResponse.json(
        { success: false, message: "+15412830000 is already on Ann Lee's profile." },
        { status: 409 },
      );
    }
    return HttpResponse.json({ success: true, data: { destination: `•••• ${digits.slice(-4)}` } });
  }),

  http.post("*/users/auth/mfa/email", async () =>
    HttpResponse.json({ success: true, data: { destination: "b•••@x.com" } }),
  ),

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
