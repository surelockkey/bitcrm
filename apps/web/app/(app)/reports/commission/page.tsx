"use client";

import { DEFAULT_TIMEZONE } from "@bitcrm/types";
import { CommissionsPage } from "@/features/reports/components/commissions-page";
import { todayIn } from "@/features/reports/commissions/lib";

export default function Page() {
  // The presets end on the business's day (Workiz's account zone), not the browser's.
  return <CommissionsPage today={todayIn(DEFAULT_TIMEZONE)} />;
}
