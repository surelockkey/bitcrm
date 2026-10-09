import { describe, expect, it } from "vitest";
import { nextAuthStep } from "./login-flow";

/**
 * What the password step's answer means for the screen: the tokens (signed
 * in), Cognito's first-password challenge, the texted code (with the email
 * option when the account allows it), or — the account requires two-factor
 * authentication and this person has no phone — the set-up step.
 */
const tokens = { accessToken: "a", refreshToken: "r", idToken: "i", expiresIn: 3600 };

describe("nextAuthStep", () => {
  it("signs in on tokens", () => {
    expect(nextAuthStep(tokens)).toEqual({ kind: "signed-in", tokens });
  });

  it("sends a first password to the set-password screen with its session", () => {
    expect(nextAuthStep({ challengeName: "NEW_PASSWORD_REQUIRED", session: "cog-1" })).toEqual({
      kind: "set-password",
      session: "cog-1",
    });
  });

  it("asks for the texted code, naming the masked phone", () => {
    expect(nextAuthStep({ challengeName: "SMS_MFA", session: "mfa-1", destination: "•••• 1234" })).toEqual({
      kind: "mfa-code",
      challenge: { session: "mfa-1", destination: "•••• 1234" },
    });
  });

  it("carries the email the code may go to instead, when the account allows it", () => {
    expect(
      nextAuthStep({ challengeName: "SMS_MFA", session: "mfa-1", destination: "•••• 1234", emailDestination: "b•••@x.com" }),
    ).toEqual({
      kind: "mfa-code",
      challenge: { session: "mfa-1", destination: "•••• 1234", emailDestination: "b•••@x.com" },
    });
  });

  it("asks to set up a phone when the account requires two-factor authentication and there is none", () => {
    expect(nextAuthStep({ challengeName: "MFA_SETUP", session: "setup-1" })).toEqual({
      kind: "mfa-setup",
      challenge: { session: "setup-1", destination: "", setup: true },
    });
  });
});
