"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Password reset is also reachable from Profile while signed in, so these
 * screens serve both states. Bouncing a signed-in user off them strands the
 * emailed code with nowhere to enter it.
 */
const SIGNED_IN_ALLOWED = ["/forgot-password"];

function allowsSignedIn(pathname: string): boolean {
  return SIGNED_IN_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Auth screens are for signed-out users — bounce authenticated users to the app. */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const hasSession = useAuthStore((s) => Boolean(s.session));

  useEffect(() => {
    if (hasSession && !allowsSignedIn(pathname)) router.replace("/");
  }, [hasSession, pathname, router]);

  return <>{children}</>;
}
