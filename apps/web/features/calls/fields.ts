import { create } from "zustand";
import { persist } from "zustand/middleware";
import { orderedColumns, type VisibleFields } from "@/features/deals/fields";

/**
 * The call log's columns — Workiz's ten (`callsReportSettings.reportFields`:
 * Status, From, To, Time, Call Flow, Ad Source, Tags, Answered By, Jobs &
 * Leads, Revenue), at the widths its grid lays them out at on a 1600px
 * screen (callspage_wz_01, 1398px between the frame's edges). Workiz's other
 * fields (Sentiment, Booked, Intent, Dispatcher Score, Objections, Pricing)
 * are AI grades we have no source for. "Job tags" is ours: the linked job's
 * tags, which Workiz has no column for — offered, off by default.
 */
export type CallColumnId =
  | "status"
  | "from"
  | "to"
  | "time"
  | "flow"
  | "source"
  | "tags"
  | "answeredBy"
  | "job"
  | "revenue"
  | "jobTags";

export interface CallColumn {
  id: CallColumnId;
  label: string;
  /** Workiz's minimum for the column (react-table `minWidth`); see `WzScrollGrid`. */
  width: number;
  /** Keeps its width when the page is wider than the columns (Workiz sets these). */
  fixed?: boolean;
  /** Money: shown only with `financials.view`. */
  money?: boolean;
}

/**
 * Workiz's columns at the widths its grid holds them to (the 1440×800 probe
 * of 2026-10-09, the page too narrow for any to grow: 1245px in all). On a
 * wider page the ones without `fixed` share the rest in proportion — at
 * 1600 that gives callspage_wz_01's 70 / 160 / 123 / 148 / 180 / 123 / 167 /
 * 180 / 123 / 123 on the 1398px grid.
 */
export const CALL_COLUMNS: readonly CallColumn[] = [
  { id: "status", label: "Status", width: 70, fixed: true },
  { id: "from", label: "From", width: 160, fixed: true },
  { id: "to", label: "To", width: 100 },
  { id: "time", label: "Time", width: 120 },
  { id: "flow", label: "Call Flow", width: 180, fixed: true },
  { id: "source", label: "Ad Source", width: 100 },
  { id: "tags", label: "Tags", width: 135 },
  { id: "answeredBy", label: "Answered By", width: 180, fixed: true },
  { id: "job", label: "Jobs & Leads", width: 100 },
  { id: "revenue", label: "Revenue", width: 100, money: true },
  { id: "jobTags", label: "Job tags", width: 160 },
];

export const DEFAULT_CALL_FIELDS: VisibleFields = Object.fromEntries(
  CALL_COLUMNS.map((c) => [c.id, c.id !== "jobTags"]),
);

/** What the Fields drawer offers this viewer: no money column without `financials.view`. */
export function callColumnOptions(showMoney: boolean): CallColumn[] {
  return CALL_COLUMNS.filter((c) => showMoney || !c.money);
}

/** The columns drawn, in the order saved in the drawer. */
export function visibleCallColumns(visible: VisibleFields, order: readonly string[], showMoney: boolean): CallColumn[] {
  return orderedColumns(callColumnOptions(showMoney), visible, order);
}

/** A stored choice, coerced: known columns keep their booleans, the rest fall back. */
export function sanitizeCallFields(raw: unknown): VisibleFields {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    CALL_COLUMNS.map((c) => [c.id, typeof source[c.id] === "boolean" ? (source[c.id] as boolean) : DEFAULT_CALL_FIELDS[c.id]]),
  );
}

interface CallFieldsState {
  visible: VisibleFields;
  /** The order the drawer's "Fields in use" was dragged into; empty = registry order. */
  order: string[];
  save: (next: { visible: VisibleFields; order: string[] }) => void;
}

/** The reader's columns for the call log, per browser — as the jobs list keeps its own. */
export const useCallFieldsStore = create<CallFieldsState>()(
  persist(
    (set) => ({
      visible: DEFAULT_CALL_FIELDS,
      order: [],
      save: ({ visible, order }) => set({ visible: { ...visible }, order: [...order] }),
    }),
    {
      name: "bitcrm.calls-fields",
      merge: (persisted, current) => {
        const p = persisted as { visible?: unknown; order?: unknown } | undefined;
        const order = Array.isArray(p?.order) ? p.order.filter((v): v is string => typeof v === "string") : [];
        return { ...current, visible: sanitizeCallFields(p?.visible), order };
      },
    },
  ),
);
