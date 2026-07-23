export interface DealProduct {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  costCompany: number;
  costForTech: number;
  priceClient: number;
  /** Which assigned technician's container this line was pulled from. */
  sourceTechId?: string;
  addedBy: string;
  addedAt: string;
}
