import { InventoryStatus } from '../enums/inventory-status.enum';
import { Transfer } from './transfer.entity';

/**
 * One line of a container template: how many of a product a van should carry.
 * `productName` / `sku` are snapshots taken when the line was saved, so the
 * template reads without a lookup per line.
 */
export interface ContainerTemplateItem {
  productId: string;
  productName: string;
  sku: string;
  /** Target quantity, a whole number of at least 1. */
  quantity: number;
}

/**
 * The "ideal loadout" of a technician's van: created once, then any container
 * can be compared against it and filled from a warehouse. Nothing is ever
 * deducted from a template. Archived rather than deleted — containers may
 * reference it through `Container.templateId`.
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

/** One template line against one container (and, optionally, the warehouse that would fill it). */
export interface ContainerTemplateDiffLine {
  productId: string;
  productName: string;
  sku: string;
  /** The template quantity. */
  target: number;
  /** What the container holds now. */
  onHand: number;
  /** `max(0, target - onHand)` — never negative for an overstocked van. */
  missing: number;
  /** What the chosen warehouse holds; present only when a warehouse was given. */
  available?: number;
  /** `min(missing, available)` — what "Fill from warehouse" would move; with a warehouse only. */
  willMove?: number;
}

export interface ContainerTemplateDiff {
  templateId: string;
  templateName: string;
  containerId: string;
  containerName: string;
  warehouseId?: string;
  warehouseName?: string;
  /** In template order. */
  lines: ContainerTemplateDiffLine[];
  /** Lines with `missing > 0` — "this van is not ready". */
  shortLineCount: number;
  /** Σ `missing` over the lines. */
  missingUnits: number;
}

/** What "Fill from warehouse" did. */
export interface ContainerTemplateFillResult {
  /** The one warehouse → container transfer; absent when nothing could move. */
  transfer?: Transfer;
  /** The lines that moved, `willMove` units each. */
  moved: ContainerTemplateDiffLine[];
  /** The lines still short after the fill (`willMove < missing`). */
  short: ContainerTemplateDiffLine[];
  /**
   * The answer of an earlier fill with the same `requestId` (a double submit
   * or a retry): nothing moved this time.
   */
  replayed?: boolean;
}
