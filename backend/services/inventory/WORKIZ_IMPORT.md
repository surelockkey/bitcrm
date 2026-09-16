# Inventory — Workiz import rules

What the Workiz price-book / inventory generator must write so the rows behave
under BitCRM without code changes, and what the inventory service tolerates on
read. The generator lives in the `workiz-data-parser` repo
(`workiz/bitcrm/entities/inventory.py`, `jobs.py`); its format document is
`docs/import/bitcrm_format/inventory.md`. This file is the BitCRM-side contract
those two are held to.

Item shapes are the repositories' (`PRODUCT#<id>/METADATA`, `SKU#<sku>/PRODUCT`,
`ITEM_CATEGORY#`, `BRAND#`, `WAREHOUSE#`, `CONTAINER#`, `<WAREHOUSE|CONTAINER>#<id>/STOCK#<productId>`).
Extra attributes the importer adds are kept in DynamoDB; `update` writes only
the fields it is given, and the mappers now carry unknown attributes through
(`toEntity` / `toProduct` / `toContainer` / `toWarehouse` spread the stored row
and then override the typed fields), so importer data survives edits from the UI.

## 1. Category

- `Product.category` stays **required** in the API (`@IsString`, the web form
  says "Category is required") — it is the `CategoryIndex` partition key
  (`GSI1PK = CATEGORY#<name>`) and cannot be empty.
- Items without a category (13 195 of 15 832; plus the 2 items whose Workiz
  category id 2987/2989 no longer exists) are written with
  `category: "Uncategorized"` — the exact spelling of
  `UNCATEGORIZED_CATEGORY` in `@bitcrm/types`. `GSI1PK` is then
  `CATEGORY#Uncategorized`.
- The importer **does not have to write** an `ITEM_CATEGORY#` row for it
  (`WRITE_UNCATEGORIZED_CATEGORY = False` in the generator is fine): the
  inventory service seeds the catalog row on demand —
  - on boot, when any product references `Uncategorized` and the catalog lacks
    it (`UncategorizedCategorySeed`, idempotent);
  - whenever a product is created/updated/CSV-imported with that category
    (`ProductsService.prepareCategory` → `ItemCategoriesService.ensureUncategorized`).
  If the importer does write the row, spell the name `Uncategorized` and
  `GSI1SK = "uncategorized"`; the seed then finds it and writes nothing.
- Any casing of `uncategorized` sent through the API is stored as
  `Uncategorized`. Every other category name is stored verbatim and must equal
  the catalog row's `name` byte for byte (the archive-on-delete rule matches by
  name). Hierarchy is the full path joined with ` > `, each part trimmed.
- Catalog rows (`ITEM_CATEGORY#`, `BRAND#`) may carry `externalId`,
  `parentId`, `description`, `workizFileId`, `workizFilePath`; a rename or
  archive from the UI now keeps them.
