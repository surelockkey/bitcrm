import { AGING_BUCKET_LABELS, AGING_SORTS, type AgingBucket, type AgingRow, type AgingSort, type ReportCard } from "@bitcrm/types";
import type { WzKpiTone } from "@/components/workiz/kpi-card";
import type { WzPagerState } from "@/components/workiz/pager";
import type { WzSortDir } from "@/components/workiz/report-grid";
import { formatPhone } from "@/lib/phone";
import type { AgingParams } from "./lib";
import { money } from "./components/report-bits";

/**
 * The rules of the Aging invoices page drawn as Workiz draws it
 * (rep_aging_wz_*, notes `docs/import/app-parity-2026-10-08/rep_aging.md`).
 * The arithmetic is the server's (`GET /billing/invoices/aging`); this is
 * what the page prints and asks for.
 */

/** Workiz's card rules: `left-green` (ink), lightYellowCard, `left-orange`, lightRedCard, `left-red`. */
export const AGING_CARD_TONES: Record<AgingBucket, WzKpiTone> = {
  all: "ink",
  under30: "lightYellow",
  from30to60: "orange",
  from60to90: "lightRed",
  over90: "red",
};

/**
 * A card's words. Workiz: the balance over "564 invoices due" / "under 30
 * days (34)", the count as the server sends it (no separators). Without
 * `financials.view` the count takes the money's place and the caption keeps
 * Workiz's words — the card still picks the rows.
 */
export function agingCardText(
  bucket: AgingBucket,
  card: ReportCard | undefined,
  showMoney: boolean,
): { value: string; caption: string; label: string } {
  const count = String(card?.count ?? 0);
  const words = AGING_BUCKET_LABELS[bucket];
  if (!showMoney) return { value: count, caption: words, label: `${count} ${words}` };
  const value = money(card?.amount);
  const caption = bucket === "all" ? `${count} ${words}` : `${words} (${count})`;
  return { value, caption, label: `${value} ${caption}` };
}

/** The grid's sort: `null` until a header is clicked (Workiz opens with `sorted: []`). */
export type AgingGridSort = { column: string; dir: WzSortDir } | null;

const isAgingSort = (v: string): v is AgingSort => (AGING_SORTS as readonly string[]).includes(v);

/** The query for a card, a sort and a page. No sort clicked → the server's own order. */
export function agingParams({
  bucket,
  sort,
  page,
  pageSize,
}: {
  bucket: AgingBucket;
  sort: AgingGridSort;
  page: number;
  pageSize: number;
}): AgingParams {
  return {
    bucket,
    ...(sort && isAgingSort(sort.column) && { sort: sort.column, dir: sort.dir }),
    page,
    pageSize,
  };
}

/** Workiz's eight columns in order; Total and Balance need `financials.view`. */
export function agingColumnIds(showMoney: boolean): AgingSort[] {
  return AGING_SORTS.filter((id) => showMoney || (id !== "total" && id !== "balance"));
}

/**
 * The line under the client's name (Workiz ClientTableCell): the email, else
 * the phone as a call link "(210) 269-1344", else nothing.
 */
export function agingSubline(
  row: Pick<AgingRow, "clientEmail" | "clientPhone">,
): { kind: "email"; text: string } | { kind: "phone"; text: string; tel: string } | null {
  if (row.clientEmail) return { kind: "email", text: row.clientEmail };
  if (row.clientPhone) return { kind: "phone", text: formatPhone(row.clientPhone), tel: row.clientPhone };
  return null;
}

/** react-table's footer over the server's numbered pages. */
export function agingPager({
  page,
  pageSize,
  total,
  shown,
  fetching,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  shown: number;
  fetching: boolean;
  onPage: (page: number) => void;
}): WzPagerState {
  const start = (page - 1) * pageSize;
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    from: shown ? start + 1 : 0,
    to: start + shown,
    total,
    totalPages,
    canPrev: page > 1,
    canNext: page < totalPages,
    isFetching: fetching,
    prev: () => onPage(page - 1),
    next: () => onPage(page + 1),
  };
}
