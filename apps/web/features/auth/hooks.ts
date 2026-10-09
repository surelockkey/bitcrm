"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  login,
  setNewPassword,
  requestPasswordReset,
  confirmPasswordReset,
  verifyMfa,
  resendMfa,
  setupMfa,
  emailMfaCode,
} from "./api";
import { nextAuthStep, type NextAuthStep } from "./login-flow";
import { ApiError } from "@/lib/api/errors";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Sign out: drop the session AND wipe the query cache before leaving.
 *
 * The cache is keyed by resource, not by user, so without clearing it the next
 * person to sign in on this browser would see the previous user's `me`,
 * permissions and data until each query happened to refetch (`me` has a 5-min
 * staleTime, so effectively the whole previous view).
 */
export function useLogout() {
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();

  return useCallback(() => {
    clear();
    queryClient.clear();
    router.replace("/login");
  }, [clear, queryClient, router]);
}

/**
 * Where the password step's answer sends the screen, shared by the login and
 * the set-password forms: tokens → the app on a clean cache (never inherit a
 * prior user's data); a first password → /set-password with the email and
 * session it needs; a texted code, or a phone to set up first → the login
 * page's second step (the tokens wait on the server).
 */
function useFollowAuthStep() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);
  const setChallenge = useAuthStore((s) => s.setChallenge);
  const setMfaChallenge = useAuthStore((s) => s.setMfaChallenge);

  return useCallback(
    (step: NextAuthStep, email: string, { from }: { from: "login" | "set-password" }) => {
      switch (step.kind) {
        case "signed-in":
          queryClient.clear();
          setSession(step.tokens);
          router.replace("/");
          return;
        case "set-password":
          setChallenge(email, step.session);
          router.replace("/set-password");
          return;
        case "mfa-code":
        case "mfa-setup":
          setMfaChallenge(step.challenge);
          // The login page swaps its form for the second step; the
          // set-password screen hands over to it.
          if (from === "set-password") router.replace("/login");
          return;
      }
    },
    [queryClient, router, setSession, setChallenge, setMfaChallenge],
  );
}

/** Sign in. Tokens → app; NEW_PASSWORD_REQUIRED challenge → /set-password; a second step → the code or set-up step. */
export function useLogin() {
  const follow = useFollowAuthStep();

  return useMutation({
    mutationFn: (values: { email: string; password: string }) => login(values),
    onSuccess: (res, values) => follow(nextAuthStep(res), values.email, { from: "login" }),
  });
}

/**
 * First-login set-password. Answers the NEW_PASSWORD_REQUIRED challenge using
 * the email + session carried from login — the user only chooses a new password.
 * If the session has expired, we bounce back to /login.
 */
export function useSetPassword() {
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);
  const follow = useFollowAuthStep();

  return useMutation({
    mutationFn: async ({ newPassword }: { newPassword: string }) => {
      const { pendingEmail, challengeSession } = useAuthStore.getState();
      if (!pendingEmail || !challengeSession) {
        throw new ApiError(401, "Your session has expired. Please sign in again.");
      }
      return setNewPassword({
        email: pendingEmail,
        newPassword,
        session: challengeSession,
      });
    },
    // A first password signs the person in — and the second step, if their
    // account has it, comes after it just as it does after a login.
    onSuccess: (res) => follow(nextAuthStep(res), useAuthStore.getState().pendingEmail ?? "", { from: "set-password" }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        clear();
        toast.error("Your session expired. Please sign in again.");
        router.replace("/login");
      }
    },
  });
}

/** Two-step sign-in: the texted (or emailed) code for the challenge in the store. */
export function useVerifyMfa() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (code: string) => {
      const challenge = useAuthStore.getState().mfaChallenge;
      if (!challenge) throw new ApiError(401, "This code has expired. Sign in again.");
      return verifyMfa({ session: challenge.session, code });
    },
    onSuccess: (tokens) => {
      queryClient.clear();
      setSession(tokens);
      router.replace("/");
    },
  });
}

export function useResendMfa() {
  return useMutation({
    mutationFn: () => {
      const challenge = useAuthStore.getState().mfaChallenge;
      if (!challenge) throw new ApiError(401, "This code has expired. Sign in again.");
      return resendMfa(challenge.session);
    },
  });
}

/**
 * The set-up step: the phone the account's codes will go to. Once it is
 * texted, the challenge becomes a code step for that number.
 */
export function useSetupMfaPhone() {
  const setMfaChallenge = useAuthStore((s) => s.setMfaChallenge);

  return useMutation({
    mutationFn: (phone: string) => {
      const challenge = useAuthStore.getState().mfaChallenge;
      if (!challenge) throw new ApiError(401, "This sign-in has expired. Sign in again.");
      return setupMfa({ session: challenge.session, phone });
    },
    onSuccess: (res) => {
      const challenge = useAuthStore.getState().mfaChallenge;
      if (challenge) setMfaChallenge({ session: challenge.session, destination: res.destination });
    },
  });
}

/** The code to the account's email instead — offered only when the challenge names an email. */
export function useEmailMfaCode() {
  return useMutation({
    mutationFn: () => {
      const challenge = useAuthStore.getState().mfaChallenge;
      if (!challenge) throw new ApiError(401, "This code has expired. Sign in again.");
      return emailMfaCode(challenge.session);
    },
  });
}

/** Request a reset code, then advance to the confirm step with the email. */
export function useRequestReset() {
  const router = useRouter();

  return useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
    onSuccess: (_res, email) => {
      router.push(`/forgot-password/confirm?email=${encodeURIComponent(email)}`);
    },
  });
}

/** Confirm a reset with the emailed code. Success state is shown in-page. */
export function useConfirmReset() {
  return useMutation({
    mutationFn: (values: { email: string; code: string; newPassword: string }) =>
      confirmPasswordReset(values),
  });
}
