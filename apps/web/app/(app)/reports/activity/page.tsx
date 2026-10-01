"use client";

import { ActivityPage } from "@/features/reports/components/activity-page";
import { accountToday } from "@/features/reports/report-dates";

export default function Page() {
  // "Today" is today on the account's (New York) calendar.
  return <ActivityPage today={accountToday()} />;
}
