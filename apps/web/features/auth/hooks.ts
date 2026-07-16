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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: { email: string; password: string }) => login(values),
    onSuccess: (res, values) => {
      if (isChallenge(res)) {
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
    onSuccess: (tokens) => {
      // Fresh session → fresh cache, same as a normal login.
      queryClient.clear();
      setSession(tokens);
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
