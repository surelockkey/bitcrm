"use client";

import { ActivityPage } from "@/features/reports/components/activity-page";

export default function Page() {
  // "Today" is the viewer's own today, as Workiz's datepicker counts it.
  return <ActivityPage />;
}
