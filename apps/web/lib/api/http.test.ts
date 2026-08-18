import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  http,
  setAuthTokenProvider,
  setSessionRefresher,
  setUnauthorizedHandler,
} from "./http";

/**
 * An expired session is the ordinary end of an hour's work. Before this, every
 * request after that hour 401'd while the page still looked signed in — and
 * because the 401 handler clears the session, the request after that went out
 * with no token at all. That is what made saving a profile phone fail
 * "sometimes".
 */
describe("http — an expired session renews itself", () => {
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ success: true, data }), { status: 200 });
  const unauthorized = () =>
    new Response(JSON.stringify({ success: false }), { status: 401 });

  let token: string | null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    token = "expired";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setAuthTokenProvider(() => token);
    setUnauthorizedHandler(() => {
      token = null;
    });
    setSessionRefresher(async () => {
      token = "fresh";
      return true;
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const authHeader = (call: number) =>
    (fetchMock.mock.calls[call][1].headers as Headers).get("Authorization");

  it("renews and replays the request, so the caller never sees the 401", async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok({ id: "u1" }));

    await expect(http.put("/users/me", { phone: "+14045551234" })).resolves.toEqual({
      id: "u1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(0)).toBe("Bearer expired");
    expect(authHeader(1)).toBe("Bearer fresh");
  });

  it("ends the session only when the renewal fails", async () => {
    setSessionRefresher(async () => false);
    fetchMock.mockResolvedValue(unauthorized());

    await expect(http.get("/users/me")).rejects.toMatchObject({ status: 401 });
    // Signed out, rather than left in the half-state that swallowed writes.
    expect(token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renews once for a burst of requests, not once each", async () => {
    let renewals = 0;
    setSessionRefresher(async () => {
      renewals++;
      await new Promise((r) => setTimeout(r, 5));
      token = "fresh";
      return true;
    });
    fetchMock.mockImplementation(async () =>
      token === "fresh" ? ok({}) : unauthorized(),
    );

    await Promise.all([
      http.get("/users/me"),
      http.get("/users"),
      http.get("/deals"),
    ]);

    expect(renewals).toBe(1);
  });

  it("never tries to renew in order to log in", async () => {
    const refresher = vi.fn(async () => true);
    setSessionRefresher(refresher);
    fetchMock.mockResolvedValue(unauthorized());

    await expect(
      http.post("/users/auth/login", { email: "a@b.c", password: "x" }),
    ).rejects.toMatchObject({ status: 401 });

    // Renewing to authenticate would be circular — and would hide bad credentials.
    expect(refresher).not.toHaveBeenCalled();
  });

  it("leaves a successful request alone", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "u1" }));
    await http.get("/users/me");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
