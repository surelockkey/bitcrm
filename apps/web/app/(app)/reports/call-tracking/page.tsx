"use client";

import { CallTrackingPage } from "@/features/reports/components/call-tracking-page";
import { reportToday } from "@/features/reports/report-dates";

export default function Page() {
  // The presets count from the viewer's own today, as Workiz's datepicker does.
  return <CallTrackingPage today={reportToday()} />;
}
