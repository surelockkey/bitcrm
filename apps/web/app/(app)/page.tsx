"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PagePlaceholder } from "@/components/shell/page-placeholder";
import { usePermissions } from "@/features/auth/use-permissions";
import { TECHNICIAN_HOME } from "@/lib/nav/nav-config";

/**
 * `/` — the dashboard for the office; a technician is sent straight to
 * their day (`/my-jobs`), which is what the Workiz app opens on. The
 * redirect waits for the role to resolve so nobody sees a flash of the
 * wrong page.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { isTechnician, isLoading } = usePermissions();

  useEffect(() => {
    if (!isLoading && isTechnician) router.replace(TECHNICIAN_HOME);
  }, [isLoading, isTechnician, router]);

  if (isLoading || isTechnician) {
    return (
      <div className="flex flex-1 items-center justify-center p-8" role="status" aria-label="Loading">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <PagePlaceholder
      title="Dashboard"
      description="Your overview and key metrics will appear here."
    />
  );
}
