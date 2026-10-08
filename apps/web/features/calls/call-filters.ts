import type { CallsFilter } from "./lib";

/**
 * Workiz's "+ Add filter" on the call log (callspage_wz_05_*). Every panel
 * Workiz draws with checkboxes takes several values — `GET /telephony/calls`
 * takes comma lists — and Duration and Masking calls are radios, as in
 * Workiz. Job Status offers only what the call row itself can answer
 * (linked to a job or not): a job's status lives with the job, so Workiz's
 * per-status rows (Submitted, In progress…) are not offered. Status leaves
 * out Workiz's "Show also blocked calls" and "Missed - Response needed" — we
 * block nothing and track no call-backs.
 */
export type CallFilterKind = "direction" | "status" | "duration" | "job" | "flow" | "source" | "user" | "tag" | "masking";

export interface CallFilterKindDef {
  kind: CallFilterKind;
  /** Workiz's name for it — the menu row and the chip's "Direction is …". */
  label: string;
  /** Checkboxes (several values) or radios (one). */
  multi: boolean;
  /** The panel's search box, Workiz's words ("Search ad group"). */
  searchLabel: string;
}

export const FILTER_KINDS: CallFilterKindDef[] = [
  { kind: "direction", label: "Direction", multi: true, searchLabel: "Search direction" },
  { kind: "status", label: "Status", multi: true, searchLabel: "Search status" },
  { kind: "duration", label: "Duration", multi: false, searchLabel: "Search duration" },
  { kind: "job", label: "Job Status", multi: true, searchLabel: "Search job status" },
  { kind: "flow", label: "Call Flow", multi: true, searchLabel: "Search call flow" },
  { kind: "source", label: "Ad Group", multi: true, searchLabel: "Search ad group" },
  { kind: "user", label: "User", multi: true, searchLabel: "Search user" },
  { kind: "tag", label: "Tags", multi: true, searchLabel: "Search tags" },
  { kind: "masking", label: "Masking calls", multi: false, searchLabel: "Search masking calls" },
];

type Option = { readonly value: string; readonly label: string };

/** Workiz's Direction panel, its words and its order. */
export const DIRECTION_OPTIONS = [
  { value: "outbound", label: "Outgoing calls" },
  { value: "inbound", label: "Incoming calls" },
] as const satisfies readonly Option[];

/** Workiz's Status categories — the server spells each out over our statuses. */
export const STATUS_OPTIONS = [
  { value: "answered", label: "Answered" },
  { value: "missed", label: "Missed" },
  { value: "active", label: "Active" },
  { value: "voicemail", label: "Voicemail" },
] as const satisfies readonly Option[];

/** Workiz's Duration radios, as whole-second bounds of talk time. */
const DURATION_BOUNDS: Record<string, Pick<CallsFilter, "minDuration" | "maxDuration">> = {
  under30: { maxDuration: "29" },
  under60: { maxDuration: "59" },
  over60: { minDuration: "61" },
  under180: { maxDuration: "179" },
  over180: { minDuration: "181" },
  over300: { minDuration: "301" },
};

export const DURATION_OPTIONS = [
  { value: "under30", label: "Under 30 sec" },
  { value: "under60", label: "Under 1 min" },
  { value: "over60", label: "Over 1 min" },
  { value: "under180", label: "Under 3 min" },
  { value: "over180", label: "Over 3 min" },
  { value: "over300", label: "Over 5 min" },
] as const satisfies readonly Option[];

/** The two rows of Workiz's Job Status panel a call row can answer. */
export const JOB_OPTIONS = [
  { value: "with", label: "All with job" },
  { value: "none", label: "No job linked" },
] as const satisfies readonly Option[];

export const MASKING_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const satisfies readonly Option[];

/** The panels whose options are fixed — a chip lists its picks in their order. */
export const FIXED_OPTIONS: Partial<Record<CallFilterKind, readonly Option[]>> = {
  direction: DIRECTION_OPTIONS,
  status: STATUS_OPTIONS,
  duration: DURATION_OPTIONS,
  job: JOB_OPTIONS,
  masking: MASKING_OPTIONS,
};

/** One chip on the filter row: the kind and the values applied to it. */
export interface CallFilterChip {
  kind: CallFilterKind;
  values: string[];
}

const kindDef = (kind: CallFilterKind) => FILTER_KINDS.find((k) => k.kind === kind)!;

/**
 * The chips, the search box and the date window as `GET /telephony/calls`
 * parameters. A chip with nothing ticked — Workiz's "(any)" — filters nothing,
 * and so does a yes/no panel with both ticked.
 */
export function toCallsFilter(
  chips: readonly CallFilterChip[],
  base: Pick<CallsFilter, "q" | "dateFrom" | "dateTo">,
): CallsFilter {
  const out: CallsFilter = {};
  if (base.q) out.q = base.q;
  if (base.dateFrom) out.dateFrom = base.dateFrom;
  if (base.dateTo) out.dateTo = base.dateTo;
  for (const chip of chips) {
    const values = chip.values;
    if (!values.length) continue;
    const list = values.join(",");
    switch (chip.kind) {
      case "direction":
        if (values.length === 1) out.direction = values[0];
        break;
      case "status":
        out.status = list;
        break;
      case "duration":
        Object.assign(out, DURATION_BOUNDS[values[0]] ?? {});
        break;
      case "job":
        if (values.length === 1) out.hasJob = values[0] === "with" ? "true" : "false";
        break;
      case "flow":
        out.flowId = list;
        break;
      case "source":
        out.sourceId = list;
        break;
      case "user":
        out.agentId = list;
        break;
      case "tag":
        out.tagId = list;
        break;
      case "masking":
        out.masked = values[0] === "yes" ? "true" : "false";
        break;
    }
  }
  return out;
}

/** "Direction is (any)" / "Direction is Incoming calls" — the chip's two halves. */
export function chipSummary(
  chip: CallFilterChip,
  labelOf: (kind: CallFilterKind, value: string) => string,
): { name: string; value: string } {
  const name = kindDef(chip.kind).label;
  if (!chip.values.length) return { name, value: "(any)" };
  // A fixed panel lists its picks in the panel's order, not the order ticked.
  const fixed = FIXED_OPTIONS[chip.kind];
  const values = fixed ? fixed.map((o) => o.value as string).filter((v) => chip.values.includes(v)) : chip.values;
  return { name, value: values.map((v) => labelOf(chip.kind, v)).join(", ") };
}

/**
 * What "+ Add filter" lists: the kinds not on a chip yet, narrowed by its
 * "Search filters" box, without a kind the viewer has no options for (no
 * call-tag or call-flow catalog without `settings.view`, no ad groups
 * without the job-source catalog).
 */
export function addableFilters(
  chips: readonly CallFilterChip[],
  query: string,
  available: Record<CallFilterKind, boolean>,
): CallFilterKindDef[] {
  const q = query.trim().toLowerCase();
  return FILTER_KINDS.filter(
    (k) => available[k.kind] && !chips.some((c) => c.kind === k.kind) && (!q || k.label.toLowerCase().includes(q)),
  );
}
