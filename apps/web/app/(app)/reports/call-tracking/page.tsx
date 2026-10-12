"use client";

import { CallTrackingPage } from "@/features/reports/components/call-tracking-page";
import { reportToday } from "@/features/reports/report-dates";

export default function Page() {
  // The presets count from Connecticut's today, not the browser's (2026-10-12 owner rule).
  return <CallTrackingPage today={reportToday()} />;
}
