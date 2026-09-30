"use client";

import { useCallback, useMemo } from "react";
import { Briefcase, MessageSquare, PhoneCall } from "lucide-react";
import type { AutomationCallOutcome, AutomationTrigger, AutomationTriggerKind } from "@bitcrm/types";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { SUPER_STATUS_LABEL } from "../../lib";
import type { PickerOption } from "../../components/automation-value-picker";

/** A closed set, so the options never depend on a catalog having loaded. */
export const SUPER_STATUS_OPTIONS: PickerOption[] = Object.entries(SUPER_STATUS_LABEL).map(
  ([id, name]) => ({ id, name }),
);

/* ------------------------------------------------------------- the trigger */

/**
 * The three things a rule can be about. Leads, estimates and invoices are
 * deliberately absent — the owner ruled them out of scope, and an entity
 * offered here that the engine never delivers is a rule that never fires.
 */
export type TriggerEntity = "job" | "call" | "message";

export const TRIGGER_ENTITIES: PickerOption[] = [
  { id: "job", name: "a job", icon: <Briefcase className="size-4" /> },
  { id: "call", name: "a call", icon: <PhoneCall className="size-4" /> },
  { id: "message", name: "a message", icon: <MessageSquare className="size-4" /> },
];

export interface TriggerEvent {
  id: string;
  /** The second half of "When a job …". */
  name: string;
  kind: AutomationTriggerKind;
  /** `call.completed` only — the outcome this event means. */
  callOutcome?: AutomationCallOutcome;
  hint?: string;
}

/**
 * What each entity can do, in Workiz's words. `is coming up` is ours: Workiz
 * puts the relative reminder in a place of its own, but our
 * `schedule.relative` is a trigger like any other and the old editor could
 * choose it — so it is an event of the job, not a capability quietly dropped.
 */
export const TRIGGER_EVENTS: Record<TriggerEntity, TriggerEvent[]> = {
  job: [
    { id: "created", name: "is created", kind: "deal.created" },
    { id: "status", name: "has a status of", kind: "deal.status_changed" },
    { id: "tech", name: "is assigned to a tech", kind: "deal.tech_assigned" },
    { id: "rescheduled", name: "is rescheduled", kind: "deal.scheduled_changed" },
    {
      id: "matches",
      name: "matches",
      kind: "deal.updated",
      hint: "any change — fires the first time the conditions hold",
    },
    {
      id: "upcoming",
      name: "is coming up",
      kind: "schedule.relative",
      hint: "a set time ahead of or after the job's date",
    },
  ],
  call: [
    { id: "missed", name: "is missed", kind: "call.completed", callOutcome: "missed" },
    { id: "answered", name: "is answered", kind: "call.completed", callOutcome: "answered" },
    { id: "voicemail", name: "goes to voicemail", kind: "call.completed", callOutcome: "voicemail" },
    { id: "ends", name: "ends", kind: "call.completed", callOutcome: "any" },
  ],
  message: [{ id: "received", name: "is received", kind: "message.received" }],
};

export function entityOfKind(kind: AutomationTriggerKind): TriggerEntity {
  if (kind === "call.completed") return "call";
  if (kind === "message.received") return "message";
  return "job";
}

/** Which row of `TRIGGER_EVENTS` a stored trigger is sitting on. */
export function eventIdOfTrigger(trigger: AutomationTrigger): string {
  const entity = entityOfKind(trigger.kind);
  if (entity === "call") {
    return TRIGGER_EVENTS.call.find((e) => e.callOutcome === (trigger.callOutcome ?? "any"))?.id ?? "ends";
  }
  return TRIGGER_EVENTS[entity].find((e) => e.kind === trigger.kind)?.id ?? TRIGGER_EVENTS[entity][0].id;
}

export const eventById = (entity: TriggerEntity, id: string): TriggerEvent | undefined =>
  TRIGGER_EVENTS[entity].find((e) => e.id === id);

/* ----------------------------------------------------------- the catalogs */

export interface ConditionCatalog {
  /** The values a condition on `field` can hold. */
  optionsFor: (field: string) => PickerOption[];
  /** The sub-statuses filed under these super-statuses; all of them when none is named. */
  subStatusesUnder: (superStatuses: string[]) => PickerOption[];
  /** Which super-status a sub-status is filed under, when the catalog knows. */
  groupOf: (subStatusId: string) => string | undefined;
  tags: PickerOption[];
}

/**
 * The job catalogs the panels pick from. One hook, so a panel never reaches
 * for a query itself and every panel resolves an id to the same name; the
 * queries behind it are shared and long-cached, so mounting a second panel
 * costs nothing.
 */
export function useConditionCatalog(): ConditionCatalog {
  const { data: tags } = useJobTags();
  const { data: types } = useJobTypes();
  const { data: sources } = useJobSources();
  const { data: statuses } = useJobStatuses();
  // Offered as a condition field, so it needs the catalog behind it: without
  // this, picking "Service area" opened an empty list and the rule could only
  // be narrowed by the fields that happened to be wired.
  const { data: areas } = useServiceAreas();

  const tagOptions = useMemo<PickerOption[]>(
    () => (tags ?? []).map((t) => ({ id: t.id, name: t.name })),
    [tags],
  );
  const optionsFor = useCallback(
    (field: string): PickerOption[] => {
      if (field === "tag") return tagOptions;
      if (field === "jobType") return (types ?? []).map((t) => ({ id: t.id, name: t.name }));
      if (field === "source") return (sources ?? []).map((s) => ({ id: s.id, name: s.name }));
      if (field === "subStatus") return (statuses ?? []).map((s) => ({ id: s.id, name: s.name }));
      if (field === "serviceArea") return (areas ?? []).map((a) => ({ id: a.id, name: a.name }));
      if (field === "status") return SUPER_STATUS_OPTIONS;
      return [];
    },
    [tagOptions, types, sources, statuses, areas],
  );

  const subStatusesUnder = useCallback(
    (superStatuses: string[]): PickerOption[] =>
      (statuses ?? [])
        .filter((s) => s.active && (!superStatuses.length || superStatuses.includes(s.group)))
        .map((s) => ({ id: s.id, name: s.name })),
    [statuses],
  );

  const groupOf = useCallback(
    (id: string) => (statuses ?? []).find((s) => s.id === id)?.group,
    [statuses],
  );

  return { optionsFor, subStatusesUnder, groupOf, tags: tagOptions };
}
