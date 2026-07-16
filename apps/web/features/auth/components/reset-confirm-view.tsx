"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCard } from "@/components/auth/auth-card";
import { BackToSignIn } from "@/components/auth/back-to-sign-in";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { ResetConfirmForm } from "./reset-confirm-form";

function SuccessBadge() {
  return (
    <div className="flex size-16 items-center justify-center rounded-2xl bg-green-100 dark:bg-green-950/40">
      <CircleCheck className="size-8 text-green-600" />
    </div>
  );
}

export function ResetConfirmView() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const [done, setDone] = useState(false);
  // Reset can start from Profile, and the session survives it — a signed-in
  // user must land back in the app, not on a sign-in screen they'd bounce off.
  const hasSession = useAuthStore((s) => Boolean(s.session));

  if (done) {
    return (
      <AuthShell
        title="Password updated"
        subtitle={
          hasSession
            ? "Your password has been changed. You're still signed in on this device."
            : "Your password has been reset. You can now sign in with your new password."
        }
        icon={<SuccessBadge />}
      >
        <AuthCard>
          <Button
            asChild
            variant="brand"
            className="h-11 w-full text-[0.95rem] font-semibold"
          >
            {hasSession ? (
              <Link href="/profile">Back to profile</Link>
            ) : (
              <Link href="/login">Back to sign in</Link>
            )}
          </Button>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Enter reset code"
      subtitle={`Enter the code sent to ${email || "your email"} and choose a new password.`}
      footer={hasSession ? undefined : <BackToSignIn />}
    >
      <ResetConfirmForm email={email} onDone={() => setDone(true)} />
    </AuthShell>
  );
}
