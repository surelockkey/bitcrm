import { RequireAuth } from "@/features/auth/components/require-auth";
import { AppShell } from "@/components/shell/app-shell";

/**
 * Authenticated area. RequireAuth gates access; AppShell provides the sidebar,
 * header, and command palette. Every route in this group is protected.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
