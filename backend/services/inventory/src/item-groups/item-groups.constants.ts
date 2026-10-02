/**
 * Item groups live in the shared BitCRM_Inventory table beside the products —
 * the rows the Workiz import writes, the members inline:
 *   PK = ITEM_GROUP#<id>, SK = METADATA, members = [...]
 *   GSI1PK = CATALOG#ITEM_GROUP, GSI1SK = <name lowercased>
 */
export const ITEM_GROUP_PK_PREFIX = 'ITEM_GROUP#';
export const ITEM_GROUP_SK = 'METADATA';
export const ITEM_GROUP_GSI1PK = 'CATALOG#ITEM_GROUP';
