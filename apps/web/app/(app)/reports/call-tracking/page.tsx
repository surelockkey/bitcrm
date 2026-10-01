"use client";

import { CallTrackingPage } from "@/features/reports/components/call-tracking-page";
import { accountToday } from "@/features/reports/report-dates";

export default function Page() {
  // The presets count from today on the account's (New York) calendar.
  return <CallTrackingPage today={accountToday()} />;
}
