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

## 2. Price, quantity, SKU

### 2.1 Price and cost

- `costCompany`, `costTech`, `priceClient` are `@IsNumber @Min(0)` — **0 is
  valid** and needs nothing from the importer: write `0` for every item whose
  Workiz `cost` / `price` is null or 0. The web form and the CSV importer
  accept 0 too (`money = z.coerce.number().min(0)`; `validateCsvRow` only
  rejects a blank or non-numeric cell).
- The 61 items with a **negative** price (35 service, 25 product, 1 other) are
  written as-is by the importer (a direct `PutItem` does not run the DTO). They
  are not creatable through `POST /products` and that stays true — the tolerance
  is on the **edit** path, below.
- Negative money must never be introduced by the API: `POST /products` and any
  `PUT` that actually carries `priceClient` still reject it.

### 2.2 Editing an imported item — validate only what the request changes

`PUT /products/:id` takes `UpdateProductDto = PartialType(CreateProductDto)`,
so it validates **only the fields present in the body** (an empty body is
valid and just bumps `updatedAt`). The web editor now sends exactly the fields
the user edited (`ProductForm` passes react-hook-form's `dirtyFields` as the
`changed` argument; `ProductEditorPage` puts that object), and the edit form
waives a cap for any value it received unchanged from the server
(`updateProductSchemaFor(original)`).

So these imported values render and stay editable instead of dead-ending in a
form that cannot be submitted or a 400:

| Workiz data | Count | Rule it breaks |
|---|---|---|
| item name > 120 chars | 262 | web `name.max(120)` |
| item name with edge spaces | 3 116 | compared trimmed, so it is "unchanged" |
| description > 1000 chars | 144 | web `description.max(1000)` |
| negative `priceClient` | 61 | `@Min(0)` and web `money.min(0)` |

A value the user *does* change is validated in full — a name pushed past 120
chars or a price newly set below 0 is still rejected.

### 2.3 SKU (import-side uniqueness is the importer's job)

`sku` is required, **unique** and **immutable** (`update` skips `id`/`sku`).
Uniqueness is enforced by the second item `SKU#<sku>/PRODUCT {productId}` and
a two-`Put` `TransactWrite` with `attribute_not_exists(PK)`; `BatchWriteItem`
has no conditions, so a direct import must guarantee uniqueness itself:

1. Trim the Workiz `serial`.
2. Replace it with `WZ-<p_id>` when it is empty (12 654 items), longer than 64
   chars (10 items), or a duplicate — **every** member of a duplicate group
   (148 groups / 422 rows), not just the later ones.
3. Claim both `sku` and `sku.casefold()` so two serials differing only in case
   do not collide.
4. Write the `SKU#<sku>/PRODUCT` row for **every** product. Without it
   `GET /products/sku/:sku`, the barcode/SKU lookup and the CSV importer's
   update-vs-create branch all miss the item and it is created a second time.
5. Keep the original serial as `workizSerial` so nothing is lost.

### 2.4 Quantity

- Stock rows (`STOCK#<productId>`) hold a plain number; `receive` is
  `ADD quantity` and `deduct` is a conditional subtract. Both work with a
  decimal, and the importer writes the 13 298 non-zero snapshot rows directly.
- `Product.minimumStockLevel` is `@Min(0)` and the web form requires a whole
  number — write an integer (0 when Workiz has none).
- Job-line quantities are the deal-service's (`AddDealProductDto.quantity`,
  `@IsNumber @Min(1)`; the web dialog clamps to `Math.max(1, …)`). Workiz has
  762 fractional, 5 zero and 2 negative line quantities out of 175 070.
  **Rounding rule:** the importer writes the Workiz value verbatim on the
  imported row — reads return it unchanged and totals use it — but the API
  rule is unchanged, so re-configuring such a line through the UI quantises it
  to a whole number ≥ 1. The importer must log every line it writes with a
  non-integer or < 1 quantity so the 769 are reviewable.
