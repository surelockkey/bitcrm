import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useAuthStore } from "@/stores/auth-store";
import { publicGet, PublicApiError } from "./public-http";

describe("publicGet", () => {
  it("returns data without sending credentials", async () => {
    useAuthStore.setState({
      session: { idToken: "secret", accessToken: "a", refreshToken: "r", expiresIn: 3600, obtainedAt: Date.now() },
    });
    let auth: string | null = "unset";
    server.use(
      http.get("*/billing/public/portal/tok", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ success: true, data: { ok: 1 } });
      }),
    );
    await expect(publicGet("/billing/public/portal/tok")).resolves.toEqual({ ok: 1 });
    expect(auth).toBeNull();
    useAuthStore.setState({ session: null });
  });

  it("throws a status-carrying error and never touches the session on 401", async () => {
    const session = { idToken: "x", accessToken: "a", refreshToken: "r", expiresIn: 3600, obtainedAt: 1 };
    useAuthStore.setState({ session });
    server.use(
      http.get("*/billing/public/portal/bad", () =>
        HttpResponse.json({ success: false, error: { message: "Invalid link" } }, { status: 401 }),
      ),
    );
    const err = (await publicGet("/billing/public/portal/bad").catch((e: unknown) => e)) as PublicApiError;
    expect(err).toBeInstanceOf(PublicApiError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Invalid link");
    expect(useAuthStore.getState().session).toEqual(session);
    useAuthStore.setState({ session: null });
  });

  it("maps network failures to status 0", async () => {
    server.use(http.get("*/billing/public/portal/down", () => HttpResponse.error()));
    const err = (await publicGet("/billing/public/portal/down").catch((e: unknown) => e)) as PublicApiError;
    expect(err).toBeInstanceOf(PublicApiError);
    expect(err.status).toBe(0);
  });
});
