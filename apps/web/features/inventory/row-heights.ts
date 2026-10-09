import type { InventoryTabId } from "./tab-counts";

/**
 * Each Inventory tab's record row height, in px: Workiz's (pg_inventory:
 * Inventory 80 — 20px cells, top-aligned, beside the 40px picture; Locations
 * 64; User locations 78) and, for the tabs Workiz lacks, their own content's
 * (Templates' chips 64, Transfers' one-line cells 56).
 *
 * Declared on the loader's blank rows, the records and the filler alike
 * (`WzReportGrid rowHeight`, and the tab's `TabFallback`), so the rows land
 * exactly where the blanks were: app_audit 2026-10-09 measured CLS 0.08 /
 * 0.06 / 0.02 on Items / Warehouses / Templates when 57px blanks became
 * these rows.
 */
export const INVENTORY_ROW_HEIGHTS: Record<InventoryTabId, number> = {
  items: 80,
  warehouses: 64,
  containers: 64,
  "user-containers": 78,
  templates: 64,
  transfers: 56,
};
