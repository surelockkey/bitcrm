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

## 0. Key attributes — write every one of them

Every index on `BitCRM_Inventory` is **HASH + RANGE**
(`src/scripts/setup-dynamodb.ts`: `CategoryIndex` = GSI1PK/GSI1SK,
`TypeIndex` = GSI2PK/GSI2SK, `OwnerIndex` = GSI3PK/GSI3SK), so a row that
writes the partition key but **not** the matching sort key is not in that index
at all — it silently disappears from the query. A product written without
`GSI1SK` is invisible to `GET /products?category=` and to
`ItemCategoriesRepository.isReferencedByProduct`, which is what makes
`UncategorizedCategorySeed` fire and what stops the archive-on-delete rule from
hard-deleting a category 13 195 items still reference (§1).

Write these exactly as `ProductsRepository.create` / the catalog repositories do:

| Row | PK | SK | GSI1PK | GSI1SK | GSI2PK | GSI2SK |
|---|---|---|---|---|---|---|
| Product (`src/products/products.repository.ts:50-56`) | `PRODUCT#<id>` | `METADATA` | `CATEGORY#<category>` | `PRODUCT#<id>` | `TYPE#<type>` | `PRODUCT#<id>` |
| SKU claim (§2.3) | `SKU#<sku>` | `PRODUCT` | — | — | — | — |
| Item category (`item-categories.repository.ts:41-49`) | `ITEM_CATEGORY#<id>` | `METADATA` | `CATALOG#ITEM_CATEGORY` | `<name>.trim().toLowerCase()` | — | — |
| Brand (`brands.repository.ts:35-40`) | `BRAND#<id>` | `METADATA` | `CATALOG#BRAND` | `<name>.toLowerCase()` | — | — |
| Warehouse | `WAREHOUSE#<id>` | `METADATA` | — | — | — | — |
| Container | `CONTAINER#<id>` | `METADATA` | — | — | — | — |
| Stock | `WAREHOUSE#<id>` \| `CONTAINER#<id>` | `STOCK#<productId>` | — | — | — | — |

- `<type>` is the stored `type`, i.e. always `product` or `service` — the 10
  Workiz `other`/`hours` items are written `type: "service"` and therefore
  `GSI2PK: "TYPE#service"` (§4.1), never `TYPE#other`.
- `<category>` in `GSI1PK` is the product's `category` **verbatim**, including
  `CATEGORY#Uncategorized` for the sentinel (§1).
- A container with a technician also needs the sparse `OwnerIndex` pair
  `GSI3PK = OWNER#<technicianId>`, `GSI3SK = CONTAINER#<id>` — both or neither
  (§5.2).
- Deal line items live in the **deal** service's table, not this one:
  `PK = DEAL#<dealId>`, `SK = PRODUCT#<productId>`, no GSI (§3.0).

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

## 3. Job line items

### 3.0 Row shape — one line per product, keyed by the PRODUCT id

Deal lines live in the **deal** service's table (`BitCRM_Deals`):

```
PK = DEAL#<dealId>
SK = PRODUCT#<productId>        ← the catalog product id, never a line id
```

`DealProductsRepository` keys every line by `product.productId`
(`backend/services/deal/src/products/deal-products.repository.ts`: `addProduct`
:30, `removeProduct` :43, `setOrderedAt` :73, `findProduct` :90,
`setFulfillment` :138), and `toProduct` reads `productId` from the item
attribute, not from the `SK`. `findByDeal` is a `begins_with(SK, 'PRODUCT#')`
query, so a row written under any other suffix still *lists*, but every
by-key operation misses it:

- edit → `replaceProduct` 404 `Product <id> not found on deal <id>`;
- delete → the same 404;
- "Mark ordered" → `ConditionalCheckFailed` on `attribute_exists(PK)`.

Setting `productId` to a line id instead is just as broken: the deal service
validates it against the inventory service (`deals.service.ts` →
`internalHttp.getProduct`) and 400s with "was not found in inventory", and the
web dialog's `editingProduct` lookup misses, so the line opens on the item
picker instead of the configure step.

**Per-line ids are not supported yet.** One deal can therefore hold at most one
row per product: a second line for the same product **overwrites** the first
(`addProduct` is a full `PutCommand`). The importer must **collapse duplicates
before writing** — sum the quantities of the lines that share a `dealId` +
`productId`, keep the price of the line the business cares about, and log every
group it collapsed so the merge is reviewable. Do not invent a synthetic
`productId` to keep them apart.

### 3.1 The ±15 % price band

The add-item dialog blocks any client price further than ±15 % from the
catalog price (`PRICE_BAND` in `apps/web/features/deals/lib.ts`; the backend
`AddDealProductDto` accepts any price — the rule is UI-only). 128 460 of the
156 612 matched Workiz lines differ from today's catalog price and 110 865 sit
outside the band, so without an exemption every one of those lines would open
in a dialog whose **Save** button is permanently disabled.

**The band does not judge an imported line.** `priceBandApplies(line)` is false
when either marker is present, and the importer must set one on every
historical line:

| Workiz line | Marker to write | Count |
|---|---|---|
| `type = product` / `other` | `fulfillment: "imported"` | 47 976 + 770 |
| `type = service` | `fulfillment: "service"` **and** `priceSource: "imported"` | 107 890 |

- `'imported'` is a new `DealProductFulfillment` value. It is **not accepted by
  the API** (`AddDealProductDto` still only allows `sourced` / `to_order` /
  `service`) — only the importer writes it.
- An imported line never moved BitCRM stock, and the code already agrees:
  `removeProduct` and `replaceProduct` restore only a `sourced` line, so the
  35 243 historical stock lines already folded into the 2026-09-11 opening
  snapshot are not double-counted.
- `priceSource` is `'catalog' | 'override' | 'imported'`, optional, and absent
  on every row BitCRM has written so far — readers treat "absent" as "the band
  applies".
- Editing an imported line through the UI turns it into an ordinary line
  (`fulfillment` becomes `sourced` / `to_order` / `service`, `priceSource` is
  dropped) and from then on the band applies. Swapping the item for a different
  catalog product re-applies the band immediately.
- The line list badges an imported line "Imported"; the configure step says
  "Imported from Workiz — the ±15% band doesn't apply" and shows the catalog
  price for reference.

## 4. Product type and unknown attributes

### 4.1 `other` / `hours` → `service`

`ProductType` is `product | service` and nothing here widens it (the enum is
the `TypeIndex` partition key and `assertStockable` reads it). Workiz's other
two types are both non-stockable, so:

- write `type: "service"` and `GSI2PK: "TYPE#service"` for the 9 `other` items
  and the 1 `hours` item, and keep the original word in `workizType`
  (`"other"` / `"hours"`);
- the 770 + 1 job lines for those items are service lines
  (`fulfillment: "service"`, plus `priceSource: "imported"` per §3.1).

Two safety nets, in case a row slips through raw:

- `ProductsRepository.toProduct` reads any unknown `type` back as `service`
  and fills `workizType` from the stored word — read-only, nothing is
  rewritten. A row with **no** `type` at all stays untyped so the existing
  `ProductsTypeBackfill` still heals it to `product` on boot.
- The CSV importer accepts `other` / `hours` in the `type` column and applies
  the same mapping (`normalizeProductType`), so a Workiz export round-trips.

`POST /products` is unchanged: `@IsEnum(ProductType)` still rejects anything
but `product` / `service`. The item list and editor show the Workiz word as a
second pill next to "Service".

### 4.2 Unknown attributes survive reads

`ProductsRepository.toProduct` now spreads the stored row and then writes the
typed fields over it, dropping only `PK`/`SK`/`GSI*`. So everything the
importer adds — `externalId`, `inventoryItemId`, `workizSerial`, `categoryId`,
`brandId`, `taxable`, `nonDiscountable`, `manageStock`, `availableInBooking`,
`bookingPrice`, `priceBookEnabled`, `isOverride`, `reorderLevel`,
`jobTypeIds`, `customAttributes`, `workizFileId`, `workizFilePath`,
`workizUpdatedAt` — is returned by the API and survives an edit from the UI
(`update` writes only the fields it is given). The same already holds for
`ITEM_CATEGORY#` and `BRAND#` rows (§1).

Read them off a product as `ProductWithExtras` (`Product & Record<string,
unknown>`); the typed fields always win over a stray stored value.

## 5. Stock and locations

### 5.1 `manageStock` — never deduct an untracked item

Workiz decides stock tracking per item (`manage`); BitCRM decides it per type
(`assertStockable` rejects services and nothing else). 4 266 items have
`manage = 1`, but 6 643 **product**-type items have `manage = 0` — deducting
one would 400 with "Insufficient stock" (there is no counter) and restoring it
would invent stock nobody ever counted.

- Write `manageStock: <bool>` on every product.
- `POST /transfers/deduct` and `POST /transfers/restore` now drop the items
  whose product says `manageStock: false` before touching stock, and leave them
  out of the transfer journal; if nothing is left, no stock call and no journal
  row happen at all. Services are still rejected first, as before.
- **Absent means managed** — every product BitCRM has written carries no such
  attribute, so nothing about existing data changes.
- The 35 243 historical job lines with `container_id` and `manage = 1` are
  already inside the 2026-09-11 snapshot: write them as ordinary deal lines —
  `PK = DEAL#<dealId>`, `SK = PRODUCT#<productId>` (§3.0), with
  `fulfillment: "imported"` (§3.1) — and do **not** call deduct/restore.

### 5.2 Locations — extra attributes survive an edit

`toContainer` / `toWarehouse` now spread the stored row and then write the
typed fields over it (key attributes excluded), and `create` spreads the entity
first so the repository's own `PK`/`SK`/`GSI3` always win. So these importer
attributes survive a rename, a department change or a technician reassignment
from the UI:

| Item | Extra attributes to write |
|---|---|
| `WAREHOUSE#` (3 locations) | `externalId`, `isPrimary` (1 primary: "(1) STORE") |
| `CONTAINER#` (86 locations) | `externalId`, `isPrimary`, `userLimited`, `accessUserIds[]` |

- `technicianId` is the BitCRM `User.id` and drives the sparse GSI3
  (`GSI3PK = OWNER#<technicianId>`, `GSI3SK = CONTAINER#<id>`) — write both
  keys whenever the container has a technician, and neither when it does not.
- **One technician, one container.** The API enforces it
  (`assertTechnicianFree`) and `findByTechnicianId` takes `Limit: 1`; a direct
  import bypasses the check, so the importer must not give two containers the
  same `technicianId`. The 8 secondary users in 7 containers (all inactive)
  go in `accessUserIds`, never in `technicianId`.
- Stock rows are `PK = WAREHOUSE#<id> | CONTAINER#<id>`, `SK = STOCK#<productId>`
  — write only the 13 298 non-zero rows, not all 275 722.
