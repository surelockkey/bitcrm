"use client";

import { JobStatisticsPage } from "@/features/reports/components/job-statistics-page";

export default function Page() {
  // The day the presets end on — UTC, as the Jobs report counts it.
  return <JobStatisticsPage today={new Date().toISOString().slice(0, 10)} />;
}
