import { TransferType, LocationType } from '../enums/transfer-type.enum';
import { ReturnReason } from '../enums/return-reason.enum';

export interface TransferItem {
  productId: string;
  productName: string;
  quantity: number;
}

export interface Transfer {
  id: string;
  type: TransferType;
  fromType: LocationType | null;
  fromId: string | null;
  toType: LocationType | null;
  toId: string | null;
  /** What moved. Names are the catalog's, whatever the request sent. */
  items: TransferItem[];
  /**
   * Items the request named that did not move because their product is not
   * stock-managed (`manageStock: false`). Present only when there were any,
   * so a dialog can say why the count did not change.
   */
  skippedItems?: TransferItem[];
  performedBy: string;
  performedByName: string;
  notes?: string;
  /** The job a `deduct` / `restore` moved stock for. */
  dealId?: string;
  /** Why a `return` took the stock out. */
  reason?: ReturnReason;
  createdAt: string;
}
