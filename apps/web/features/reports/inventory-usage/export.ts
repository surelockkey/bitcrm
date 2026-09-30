import { returnReasonLabel } from "@/features/inventory/transfers/lib";
import { describeLogEntry } from "./describe";
import { formatDateTime, formatJobDate, formatQty } from "./format";
import type { InventoryUsageRow, ReportLogEntry, ReportSummary } from "./types";

/** An export reads the whole filtered window; past this many rows it stops and says so. */
export const EXPORT_CAP = 20_000;

/** The largest page the report endpoints hand out (`@Max(100)`). */
export const EXPORT_PAGE_SIZE = 100;

type Page<T> = { data: T[]; pagination?: { nextCursor?: string } };

/**
 * Every row of a cursor-paged list, page by page, up to `cap`. `onProgress`
 * hears the running count after each page, for the button that shows it.
 * `maxPages` guards against a server that keeps handing out empty pages.
 */
export async function drainPages<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  { cap, onProgress, maxPages = 1_000 }: { cap: number; onProgress?: (rows: number) => void; maxPages?: number },
): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const { data, pagination } = await fetchPage(cursor);
    rows.push(...data);
    cursor = pagination?.nextCursor || undefined;
    if (rows.length >= cap) {
      return { rows: rows.slice(0, cap), capped: rows.length > cap || !!cursor };
    }
    onProgress?.(rows.length);
    if (!cursor) break;
  }
  return { rows, capped: false };
}

/** Money in a CSV is a plain number, as Workiz exports it. */
const money = (n: number | undefined): string =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "";

const qty = (n: number | undefined): string => (typeof n === "number" ? formatQty(n) : "");

/** A row's techs by name: the server's names, else its ids through the lookup. */
export function techNamesOf(
  row: Pick<InventoryUsageRow, "techNames" | "techIds">,
  techName?: (id: string) => string | undefined,
): string {
  if (Array.isArray(row.techNames) && row.techNames.length) return row.techNames.join(", ");
  if (typeof row.techNames === "string" && row.techNames.trim()) return row.techNames;
  return (row.techIds ?? [])
    .map((id) => techName?.(id))
    .filter(Boolean)
    .join(", ");
}

/** The Usage tab as Workiz exports it: its columns (money only with `financials.view`) and a Totals line. */
export function usageCsvRows(
  rows: InventoryUsageRow[],
  {
    money: withMoney,
    summary,
    techName,
  }: { money: boolean; summary?: ReportSummary; techName?: (id: string) => string | undefined },
): Record<string, string>[] {
  const out = rows.map((r) => ({
    Item: r.productName ?? "",
    SKU: r.sku ?? "",
    Job: r.dealNumber === undefined ? "" : String(r.dealNumber),
    Client: r.clientName ?? "",
    "Job date": r.jobDate ? formatJobDate(r.jobDate) : "",
    Techs: techNamesOf(r, techName),
    Qty: qty(r.qty),
    ...(withMoney && { Price: money(r.unitPrice), Cost: money(r.unitCost), Total: money(r.total) }),
  }));
  if (summary) {
    out.push({
      Item: "Totals",
      SKU: "",
      Job: "",
      Client: "",
      "Job date": "",
      Techs: "",
      Qty: qty(summary.qty),
      // Σ of unit prices means nothing; Workiz prints it, the Totals line here leaves it empty.
      ...(withMoney && { Price: "", Cost: money(summary.cost), Total: money(summary.total) }),
    });
  }
  return out;
}

/** The Returns tab: one line per return, then Σ Qty. */
export function returnsCsvRows(rows: ReportLogEntry[], summary?: ReportSummary): Record<string, string>[] {
  const out = rows.map((r) => ({
    Item: r.productName ?? "",
    SKU: r.sku ?? "",
    "Return date": r.createdAt ? formatDateTime(r.createdAt) : "",
    Qty: qty(r.quantity),
    Reason: r.reason ? returnReasonLabel(r.reason) : "",
    Location: r.fromName ?? "",
    User: r.userName ?? "",
  }));
  if (summary) {
    out.push({ Item: "Totals", SKU: "", "Return date": "", Qty: qty(summary.qty), Reason: "", Location: "", User: "" });
  }
  return out;
}

/** The Action log: the Description as on screen, the job by its number. No totals. */
export function logCsvRows(
  rows: ReportLogEntry[],
  jobNumbers: Map<string, string | number>,
): Record<string, string>[] {
  return rows.map((r) => {
    const number = r.dealNumber ?? (r.dealId ? jobNumbers.get(r.dealId) : undefined);
    return {
      Item: r.productName ?? "",
      SKU: r.sku ?? "",
      User: r.userName ?? "",
      Time: r.createdAt ? formatDateTime(r.createdAt) : "",
      Description: describeLogEntry(r, { jobNumber: number }),
      Job: number === undefined ? "" : String(number),
    };
  });
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Label → cell rows as CSV, headed by the first row's labels. A cell that a
 * spreadsheet would run as a formula (`=`, `+`, `-`, `@`) is prefixed with an
 * apostrophe — item names and reasons are typed by people.
 */
export function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const cell = (raw: string) => {
    const v = /^[=+\-@\t\r]/.test(raw) && !NUMBER.test(raw) ? `'${raw}` : raw;
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h] ?? "")).join(","))].join("\n");
}
