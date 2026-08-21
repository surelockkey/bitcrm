import { InventoryStatus } from '../enums/inventory-status.enum';

/**
 * One line of a container template: the quantity of a product a technician is
 * expected to carry. `productName`/`sku` are denormalized so the template reads
 * without a per-line product lookup (and still renders if the product is later
 * archived).
 */
export interface ContainerTemplateItem {
  productId: string;
  productName: string;
  sku: string;
  /** Target quantity the technician should have on hand. */
  quantity: number;
}

/**
 * A named "ideal loadout" for a technician's container — what a van *should*
 * carry, not what it holds. Nothing is ever deducted from a template: it exists
 * so dispatch can see the gap between target and actual stock.
 */
export interface ContainerTemplate {
  id: string;
  name: string;
  description?: string;
  items: ContainerTemplateItem[];
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}

/** One product's target-vs-actual for a container, from {@link ContainerTemplate}. */
export interface ContainerTemplateDiffLine {
  productId: string;
  productName: string;
  sku: string;
  /** Target from the template. */
  target: number;
  /** Actual quantity currently in the container. */
  onHand: number;
  /** `target - onHand`, floored at 0 — never negative when the van is overstocked. */
  missing: number;
}

export interface ContainerTemplateDiff {
  containerId: string;
  templateId: string;
  templateName: string;
  lines: ContainerTemplateDiffLine[];
  /** Lines where `missing > 0`. Cheap flag for "this van is not ready". */
  shortLineCount: number;
}
