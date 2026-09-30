import { InventoryLogAction } from '../enums/inventory-log-action.enum';
import { LocationType } from '../enums/transfer-type.enum';
import { ReturnReason } from '../enums/return-reason.enum';

/**
 * One line of the inventory audit log — what the "Inventory usage" report
 * reads. The web renders the human description from these fields; the names
 * are snapshots taken when the entry was written, and a report may re-resolve
 * them against the catalog.
 */
export interface InventoryLogEntry {
  id: string;
  action: InventoryLogAction;
  productId: string;
  productName: string;
  sku?: string;
  quantity?: number;
  fromType?: LocationType;
  fromId?: string;
  fromName?: string;
  toType?: LocationType;
  toId?: string;
  toName?: string;
  /** The job a stock use / restore belongs to. */
  dealId?: string;
  /** Why stock was returned. */
  reason?: ReturnReason;
  /** The product's client price at the time of a stock use / restore. */
  unitPrice?: number;
  /** The product's company cost at the time of a stock use / restore. */
  unitCost?: number;
  /** The product fields an `item_updated` entry changed. */
  changedFields?: string[];
  userId: string;
  userName: string;
  createdAt: string;
}
