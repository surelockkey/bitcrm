import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import {
  login,
  setNewPassword,
  requestPasswordReset,
  confirmPasswordReset,
} from "./api";
import { ApiError } from "@/lib/api/errors";

describe("auth api", () => {
  it("login returns tokens for valid credentials", async () => {
    const res = await login({ email: "a@b.com", password: "good" });
    expect("challengeName" in res).toBe(false);
    expect(res).toMatchObject({ idToken: "id-tok" });
  });

  it("login returns a NEW_PASSWORD_REQUIRED challenge on first login", async () => {
    const res = await login({ email: "a@b.com", password: "temp-pass" });
    expect(res).toEqual({ challengeName: "NEW_PASSWORD_REQUIRED", session: "sess-123" });
  });

  it("login throws a 401 ApiError on bad credentials", async () => {
    await expect(login({ email: "a@b.com", password: "wrong" })).rejects.toBeInstanceOf(ApiError);
  });

  it("setNewPassword returns tokens", async () => {
    const res = await setNewPassword({
      email: "a@b.com",
      newPassword: "Password1",
      session: "sess-123",
    });
    expect(res.idToken).toBe("id-tok");
  });

  it("setNewPassword throws on an expired session", async () => {
    await expect(
      setNewPassword({ email: "a@b.com", newPassword: "Password1", session: "expired" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("requestPasswordReset always resolves (no enumeration)", async () => {
    const res = await requestPasswordReset("unknown@b.com");
    expect(res.message).toMatch(/reset code/i);
  });

  it("confirmPasswordReset succeeds with a valid code", async () => {
    const res = await confirmPasswordReset({
      email: "a@b.com",
      code: "123456",
      newPassword: "Password1",
    });
    expect(res.message).toMatch(/reset/i);
  });

  it("confirmPasswordReset throws on an invalid code", async () => {
    await expect(
      confirmPasswordReset({ email: "a@b.com", code: "000000", newPassword: "Password1" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("api error surfacing", () => {
  it("joins array validation messages into one string", async () => {
    server.use(
      http.post("*/users/auth/login", () =>
        HttpResponse.json(
          { success: false, message: ["email must be valid", "password too short"] },
          { status: 400 },
        ),
      ),
    );
    await expect(login({ email: "x", password: "y" })).rejects.toMatchObject({
      message: "email must be valid, password too short",
    });
  });

  it("surfaces a clean message on network failure", async () => {
    server.use(http.post("*/users/auth/login", () => HttpResponse.error()));
    await expect(login({ email: "x", password: "y" })).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/unable to reach/i),
    });
  });
});
