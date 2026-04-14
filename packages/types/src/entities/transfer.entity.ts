import { TransferType, LocationType } from '../enums/transfer-type.enum';

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
  createdAt: string;
}
