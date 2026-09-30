/**
 * Custom field definitions live in the shared BitCRM_Inventory table beside
 * the products — the rows the Workiz import already writes:
 *   PK = ITEM_ATTRIBUTE#<id>, SK = METADATA
 *   GSI1PK = CATALOG#ITEM_ATTRIBUTE, GSI1SK = <name lowercased>
 */
export const ITEM_ATTRIBUTE_PK_PREFIX = 'ITEM_ATTRIBUTE#';
export const ITEM_ATTRIBUTE_SK = 'METADATA';
export const ITEM_ATTRIBUTE_GSI1PK = 'CATALOG#ITEM_ATTRIBUTE';

/** Workiz scopes custom fields by resource; the item catalog is `items`. */
export const ITEM_ATTRIBUTE_RESOURCE = 'items';

/** The product attribute that holds the values, keyed by definition name. */
export const CUSTOM_ATTRIBUTES_FIELD = 'customAttributes';

/** Products rewritten side by side when a definition is renamed or deleted. */
export const ITEM_ATTRIBUTE_WRITE_CONCURRENCY = 10;

/** Workiz's own words for a name already taken. */
export const NAME_IN_USE_MESSAGE = 'Name is in use, please pick a different one';
