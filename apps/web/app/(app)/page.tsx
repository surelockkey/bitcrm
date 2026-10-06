"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DashboardPage as Dashboard, DashboardSkeleton } from "@/features/dashboard/components/dashboard-page";
import { usePermissions } from "@/features/auth/use-permissions";
import { TECHNICIAN_HOME } from "@/lib/nav/nav-config";

/**
 * `/` — the dashboard for the office; a technician is sent straight to
 * their day (`/my-jobs`), which is what the Workiz app opens on. The
 * redirect waits for the role to resolve so nobody sees a flash of the
 * wrong page — meanwhile the dashboard's own skeleton stands, the same one
 * the dashboard holds until its numbers are in, so the page goes from grey
 * to filled once rather than spinner, then grey, then filled.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { isTechnician, isLoading } = usePermissions();

  useEffect(() => {
    if (!isLoading && isTechnician) router.replace(TECHNICIAN_HOME);
  }, [isLoading, isTechnician, router]);

  if (isLoading || isTechnician) return <DashboardSkeleton />;

  return <Dashboard />;
}
