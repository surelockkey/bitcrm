import { InventoryLogAction, UserContainerAccess } from "@bitcrm/types";
import { returnReasonLabel } from "@/features/inventory/transfers/lib";
import type { ReportLogEntry } from "./types";

/** The item fields an update names, in the words of the item form. */
const FIELD_LABELS: Record<string, string> = {
  name: "name",
  sku: "SKU",
  barcode: "barcode",
  description: "description",
  category: "category",
  type: "type",
  priceClient: "price",
  costCompany: "cost",
  costTech: "tech cost",
  taxable: "taxable",
  supplier: "supplier",
  brandId: "brand",
  photoKey: "photo",
  serialTracking: "serial tracking",
  minimumStockLevel: "minimum stock",
  manageStock: "stock tracking",
  reorderLevel: "reorder level",
};

/** A count as a sentence says it: "1", "2.5" — not the table's "1.00". */
const count = (n: number | undefined): string =>
  typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "";

const place = (name: string | undefined): string => name?.trim() || "a location";

/** A job as its link reads: "1749", as Workiz's Job column prints it — or just "Job" while the number is unknown. */
export function jobLabel(number: string | number | undefined): string {
  return number === undefined || number === "" ? "Job" : String(number);
}

const jobRef = (number: string | number | undefined): string =>
  number === undefined || number === "" ? "job" : `job #${number}`;

/**
 * An entry's Description, in Workiz's words ("Added 1 to (1) STORE", "Used 1
 * in job #1749"). The job's number comes with the entry or from the caller,
 * who resolves the numbers of the rows on screen in one call.
 */
export function describeLogEntry(
  entry: ReportLogEntry,
  { jobNumber }: { jobNumber?: string | number } = {},
): string {
  const qty = count(entry.quantity);
  const job = jobRef(entry.dealNumber ?? jobNumber);

  switch (entry.action) {
    case InventoryLogAction.ITEM_CREATED:
      return "Created new item";
    case InventoryLogAction.ITEM_UPDATED: {
      const fields = (entry.changedFields ?? []).map((f) => FIELD_LABELS[f] ?? f);
      return fields.length ? `Updated item information (${fields.join(", ")})` : "Updated item information";
    }
    case InventoryLogAction.ITEM_ARCHIVED:
      return "Archived item";
    case InventoryLogAction.ITEM_RESTORED:
      return "Restored item";
    case InventoryLogAction.STOCK_RECEIVED:
      return `Added ${qty} to ${place(entry.toName)}`;
    case InventoryLogAction.STOCK_MOVED:
      return `Moved ${qty} from ${place(entry.fromName)} to ${place(entry.toName)}`;
    case InventoryLogAction.STOCK_USED:
      return `Used ${qty} in ${job}`;
    case InventoryLogAction.STOCK_RESTORED:
      return `Returned ${qty} from ${job} to ${place(entry.toName)}`;
    case InventoryLogAction.STOCK_RETURNED:
      return `Removed ${qty} from ${place(entry.fromName)}${entry.reason ? ` (${returnReasonLabel(entry.reason)})` : ""}`;
    case InventoryLogAction.STOCK_RESTORE_SKIPPED:
      return `${qty} not returned to stock (no van)`;
    case InventoryLogAction.CONTAINER_ASSIGNED: {
      const who = entry.subjectUserName?.trim() || "A user";
      if (entry.access === UserContainerAccess.ALL) return `${who} set to All locations`;
      if (entry.access === UserContainerAccess.NONE) return `${who} set to No access`;
      return `${who} assigned to ${entry.toName?.trim() || "a container"}`;
    }
    default:
      return String(entry.action);
  }
}
