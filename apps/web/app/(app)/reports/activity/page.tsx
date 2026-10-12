"use client";

import { ActivityPage } from "@/features/reports/components/activity-page";

export default function Page() {
  // "Today" is Connecticut's (the page's `reportToday`), not the browser's — 2026-10-12 owner rule.
  return <ActivityPage />;
}
