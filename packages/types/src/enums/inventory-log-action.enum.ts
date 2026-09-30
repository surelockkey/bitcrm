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
  /** A user was given a container, another one, "All locations" or "No access". */
  CONTAINER_ASSIGNED = 'container_assigned',
}
