"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";

const emptySubscribe = () => () => {};

/** True only after client hydration (false during SSR + first client render). */
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Gate for authenticated routes. Renders children only when a session exists;
 * otherwise redirects to /login. Waits for hydration before deciding so the
 * server markup matches and localStorage has rehydrated.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const hasSession = useAuthStore((s) => Boolean(s.session));

  useEffect(() => {
    if (hydrated && !hasSession) router.replace("/login");
  }, [hydrated, hasSession, router]);

  if (!hydrated || !hasSession) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
