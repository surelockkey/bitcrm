import type { ChangePasswordResponse, LoginChallengeResponse, LoginResponse } from "@bitcrm/types";

/**
 * A second step in progress, as the login page keeps it between screens.
 * `destination` is the masked phone the code was texted to (blank until a
 * set-up gives one); `emailDestination` the masked email the code may go to
 * instead, when the account allows it; `setup` that a phone is still to be
 * given — the account requires two-factor authentication and this person
 * had none.
 */
export interface MfaChallengeState {
  session: string;
  destination: string;
  emailDestination?: string;
  setup?: boolean;
}

/** What the password step's answer means for the screen. */
export type NextAuthStep =
  | { kind: "signed-in"; tokens: LoginResponse | ChangePasswordResponse }
  | { kind: "set-password"; session: string }
  | { kind: "mfa-code"; challenge: MfaChallengeState }
  | { kind: "mfa-setup"; challenge: MfaChallengeState };

/**
 * The sign-in's state machine, in one place for the login and the
 * set-password screens: tokens sign the person in; Cognito's first-password
 * challenge goes to the set-password screen; a texted code opens the code
 * step (with the email option when the server offers one); `MFA_SETUP` —
 * the account requires two-factor authentication and there is no phone to
 * text — opens the set-up step, whose phone then turns it into a code step.
 */
export function nextAuthStep(res: LoginResponse | ChangePasswordResponse | LoginChallengeResponse): NextAuthStep {
  if (!("challengeName" in res)) return { kind: "signed-in", tokens: res };
  switch (res.challengeName) {
    case "NEW_PASSWORD_REQUIRED":
      return { kind: "set-password", session: res.session };
    case "SMS_MFA":
      return {
        kind: "mfa-code",
        challenge: {
          session: res.session,
          destination: res.destination,
          ...(res.emailDestination ? { emailDestination: res.emailDestination } : {}),
        },
      };
    case "MFA_SETUP":
      return { kind: "mfa-setup", challenge: { session: res.session, destination: "", setup: true } };
  }
}
