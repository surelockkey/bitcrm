/** What an inventory audit-log entry records — an item edit or a stock movement. */
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
}
