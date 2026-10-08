"use client";

import { useMemo } from "react";
import { WzFilterSelect, type WzFilterGroup } from "@/components/workiz";
import { useJobTags } from "@/features/job-tags/hooks";
import { tagSolidClasses } from "@/features/job-tags/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { scheduleColor } from "../calendar";
import { FILTER_GROUP, SCHEDULE_STATUS_OPTIONS, type SchedulePick } from "../filters";

/**
 * "Filter results" over the calendar (pg_schedule_wz_14c_filter_menu): the
 * bar the toolbar's filter button opens above it, with Workiz's groups side
 * by side — TEAM, TAGS, STATUS, JOB TYPE, SERVICE AREAS (each in its
 * colour). Workiz's TYPE (Jobs / Leads / Tasks / Events / Visit) is left out:
 * the calendar holds jobs only. Tags and areas are read when the bar opens.
 */
export function ScheduleFilter({
  techs,
  jobTypes,
  value,
  onChange,
}: {
  techs: { id: string; name: string }[];
  jobTypes: Map<string, string>;
  value: SchedulePick[];
  onChange: (next: SchedulePick[]) => void;
}) {
  const tags = useJobTags();
  const areas = useServiceAreas();

  const groups = useMemo<WzFilterGroup[]>(
    () => [
      {
        id: FILTER_GROUP.team,
        title: "Team",
        chipPrefix: "team",
        options: techs.map((t) => ({ value: t.id, label: t.name })),
      },
      {
        id: FILTER_GROUP.tags,
        title: "Tags",
        chipPrefix: "tag",
        options: (tags.data ?? [])
          .filter((t) => t.active !== false)
          .map((t) => ({ value: t.id, label: t.name, colorClassName: tagSolidClasses(t.color) })),
      },
      {
        id: FILTER_GROUP.status,
        title: "Status",
        chipPrefix: "status",
        options: SCHEDULE_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      },
      {
        id: FILTER_GROUP.jobType,
        title: "Job type",
        chipPrefix: "job type",
        options: [...jobTypes].map(([id, name]) => ({ value: id, label: name })).sort((a, b) => a.label.localeCompare(b.label)),
      },
      {
        id: FILTER_GROUP.areas,
        title: "Service areas",
        chipPrefix: "service area",
        options: (areas.data ?? []).map((a) => ({
          value: a.name,
          label: a.name,
          style: { backgroundColor: scheduleColor(a.name), color: "#fff" },
        })),
      },
    ],
    [techs, tags.data, jobTypes, areas.data],
  );

  return (
    <div className="shrink-0 px-4 pt-[10px] pb-[10px]">
      <WzFilterSelect groups={groups} value={value} onChange={onChange} />
    </div>
  );
}
