"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";

/** Auth screens are for signed-out users — bounce authenticated users to the app. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hasSession = useAuthStore((s) => Boolean(s.session));

  useEffect(() => {
    if (hasSession) router.replace("/");
  }, [hasSession, router]);

  return <>{children}</>;
}
