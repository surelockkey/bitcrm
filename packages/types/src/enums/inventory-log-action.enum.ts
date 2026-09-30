/**
 * What an inventory audit-log entry records — an item edit, a stock movement,
 * or a user's container assignment (the one action that names no item).
 */
export enum InventoryLogAction {
  ITEM_CREATED = 'item_created',
  ITEM_UPDATED = 'item_updated',
  ITEM_ARCHIVED = 'item_archived',
  ITEM_RESTORED = 'item_restored',
  STOCK_RECEIVED = 'stock_received',
  STOCK_MOVED = 'stock_moved',
  STOCK_USED = 'stock_used',
  STOCK_RESTORED = 'stock_restored',
  STOCK_RETURNED = 'stock_returned',
  /**
   * A job line was removed but its units could not be put back: no existing
   * container could be determined (used before the log existed, the tech now
   * on "All locations" / "No access"). Names the item, quantity and job; no `to*`.
   */
  STOCK_RESTORE_SKIPPED = 'stock_restore_skipped',
  /** A user was given a container, another one, "All locations" or "No access". */
  CONTAINER_ASSIGNED = 'container_assigned',
}
