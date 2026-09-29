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
  isChallenge,
  verifyMfa,
  resendMfa,
} from "./api";
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

/** Sign in. Tokens → app; NEW_PASSWORD_REQUIRED challenge → /set-password. */
export function useLogin() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const setChallenge = useAuthStore((s) => s.setChallenge);
  const setMfaChallenge = useAuthStore((s) => s.setMfaChallenge);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: { email: string; password: string }) => login(values),
    onSuccess: (res, values) => {
      if (isChallenge(res)) {
        if (res.challengeName === "SMS_MFA") {
          // The login page swaps its form for the code step.
          setMfaChallenge({ session: res.session, destination: res.destination });
          return;
        }
        // Carry the email + challenge session to the set-password screen.
        setChallenge(values.email, res.session);
        router.replace("/set-password");
        return;
      }
      // Start the new session on a clean cache — never inherit a prior user's data.
      queryClient.clear();
      setSession(res);
      router.replace("/");
    },
  });
}

/**
 * First-login set-password. Answers the NEW_PASSWORD_REQUIRED challenge using
 * the email + session carried from login — the user only chooses a new password.
 * If the session has expired, we bounce back to /login.
 */
export function useSetPassword() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();

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
    onSuccess: (res) => {
      // A first password signs the person in — and the second step, if their
      // account has it, comes after it just as it does after a login.
      if (isChallenge(res)) {
        if (res.challengeName === "SMS_MFA") {
          useAuthStore.getState().setMfaChallenge({ session: res.session, destination: res.destination });
          router.replace("/login");
        }
        return;
      }
      // Fresh session → fresh cache, same as a normal login.
      queryClient.clear();
      setSession(res);
      router.replace("/");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        clear();
        toast.error("Your session expired. Please sign in again.");
        router.replace("/login");
      }
    },
  });
}

/** Two-step sign-in: the texted code for the challenge in the store. */
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
