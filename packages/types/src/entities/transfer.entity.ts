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
  items: TransferItem[];
  performedBy: string;
  performedByName: string;
  notes?: string;
  /** The job a `deduct` / `restore` moved stock for. */
  dealId?: string;
  /** Why a `return` took the stock out. */
  reason?: ReturnReason;
  createdAt: string;
}
