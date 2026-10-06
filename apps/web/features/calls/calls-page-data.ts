"use client";

import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCallTags } from "@/features/call-tags/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useRoles } from "@/features/users/hooks";
import { useCallDetail, useCallJob, useLiveCalls } from "./hooks";
import { isLive } from "./lib";

/**
 * Everything the call log prints around and inside its rows, asked for by the
 * page itself, at once.
 *
 * Each cell used to ask for its own once it had mounted: the role badges for
 * the roles, the Source column for the sources, the job-tag chips for the
 * job-tag catalog (and only after the jobs had come), the call-tag chips for
 * theirs. Every answer redrew the rows a beat after they were up. These are
 * the same hooks the cells and the strip call — same keys, same options — so
 * the page's request is the one the cells read from, and nothing is asked
 * twice. (The linked jobs come with the rows themselves — `useCallsList`.)
 *
 * `allIn` is "the log can be drawn whole": the permissions too, because the
 * call-tag catalog is only asked for with `settings.view`, and a catalog not
 * yet asked for looks the same as one never to be asked for.
 */
export function useCallLogData() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const live = useLiveCalls();
  const callTags = useCallTags(can("settings"));
  const roles = useRoles();
  const sources = useJobSources();
  const jobTags = useJobTags();

  return {
    callTags: callTags.data,
    allIn: !permissionsLoading && [live, callTags, roles, sources, jobTags].every(settled),
  };
}

/**
 * Everything one call's page shows beside the call itself, asked for at once.
 *
 * The page drew the call and let each block finish on its own: the role
 * badge, the call-tag chips, the linked job (a spinner, then a taller line
 * that pushed the sections below it down) and the job's type after that.
 * Same hooks as the blocks, so the blocks read what the page brought. The
 * live strip is asked for only while the call is still going — the only time
 * the page shows it.
 */
export function useCallPageData(callId: string) {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const detail = useCallDetail(callId);
  const call = detail.data;
  const live = useLiveCalls(!!call && isLive(call));
  const callTags = useCallTags(can("settings"));
  const roles = useRoles();
  const job = useCallJob(call?.dealId);
  const jobTypes = useJobTypes();

  return {
    detail,
    allIn: !permissionsLoading && [detail, live, callTags, roles, job, jobTypes].every(settled),
  };
}
