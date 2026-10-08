import type { CallsFilter } from "./lib";

/**
 * Workiz's "+ Add filter" on the call log (callspage_wz_05_*), reduced to the
 * kinds `GET /telephony/calls` can serve. Workiz also offers Duration, Job
 * Status, Call Flow, Ad Group and Masking calls; the server has no filter for
 * those, so they are not offered (see the callspage notes for the backend ask).
 */
export type CallFilterKind = "direction" | "status" | "user" | "tag";

export interface CallFilterKindDef {
  kind: CallFilterKind;
  /** Workiz's name for it — the menu row and the chip's "Direction is …". */
  label: string;
  /**
   * Several values at once. Direction is the only one: two directions are
   * simply "any", while the server takes one status, one agent, one tag.
   */
  multi: boolean;
}

export const FILTER_KINDS: CallFilterKindDef[] = [
  { kind: "direction", label: "Direction", multi: true },
  { kind: "status", label: "Status", multi: false },
  { kind: "user", label: "User", multi: false },
  { kind: "tag", label: "Tags", multi: false },
];

/** Workiz's Direction panel, its words and its order. */
export const DIRECTION_OPTIONS = [
  { value: "outbound", label: "Outgoing calls" },
  { value: "inbound", label: "Incoming calls" },
] as const;

/** One chip on the filter row: the kind and the values applied to it. */
export interface CallFilterChip {
  kind: CallFilterKind;
  values: string[];
}

const kindDef = (kind: CallFilterKind) => FILTER_KINDS.find((k) => k.kind === kind)!;

/**
 * The chips, the search box and the date window as `GET /telephony/calls`
 * parameters. A chip with nothing ticked — Workiz's "(any)" — filters nothing.
 */
export function toCallsFilter(
  chips: readonly CallFilterChip[],
  base: Pick<CallsFilter, "number" | "dateFrom" | "dateTo">,
): CallsFilter {
  const out: CallsFilter = {};
  if (base.number) out.number = base.number;
  if (base.dateFrom) out.dateFrom = base.dateFrom;
  if (base.dateTo) out.dateTo = base.dateTo;
  for (const chip of chips) {
    const [first] = chip.values;
    if (!first) continue;
    switch (chip.kind) {
      case "direction":
        if (chip.values.length === 1) out.direction = first;
        break;
      case "status":
        out.status = first;
        break;
      case "user":
        out.agentId = first;
        break;
      case "tag":
        out.tagId = first;
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
  // Direction lists its picks in the panel's order, not the order ticked.
  const values =
    chip.kind === "direction"
      ? DIRECTION_OPTIONS.map((o) => o.value as string).filter((v) => chip.values.includes(v))
      : chip.values;
  return { name, value: values.map((v) => labelOf(chip.kind, v)).join(", ") };
}

/**
 * What "+ Add filter" lists: the kinds not on a chip yet, narrowed by its
 * "Search filters" box, without a kind the viewer has no options for (no
 * call-tag catalog without `settings.view`).
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
