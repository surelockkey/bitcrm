import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import {
  type Product,
  type ProductWithExtras,
  type JwtUser,
  InventoryLogAction,
  ProductType,
  InventoryStatus,
  UNCATEGORIZED_CATEGORY,
  WORKIZ_SERVICE_TYPES,
  type ListCount,
} from '@bitcrm/types';
import { ProductsRepository, type ProductListFilters } from './products.repository';
import { ProductsCacheService } from './products-cache.service';
import {
  S3Service,
  SnsPublisherService,
  RedisService,
  cachedCount,
  countCacheKey,
} from '@bitcrm/shared';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import { ItemCategoriesService } from '../item-categories/item-categories.service';
import { InventoryLogService } from '../inventory-log/inventory-log.service';
import { ItemAttributesRepository } from '../item-attributes/item-attributes.repository';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';

/**
 * Canonical spelling for the no-category sentinel: `uncategorized` in any case
 * is stored as `Uncategorized`, so all such items share one CategoryIndex
 * partition and one catalog row. Every other category name is kept verbatim —
 * it must equal the catalog row's name byte for byte.
 */
export function normalizeCategory(category: string): string {
  return category.trim().toLowerCase() === UNCATEGORIZED_CATEGORY.toLowerCase()
    ? UNCATEGORIZED_CATEGORY
    : category;
}

const KNOWN_PRODUCT_TYPES: readonly string[] = Object.values(ProductType);

/** How long a list count stays good enough. Matches the deals tab counts. */
const COUNT_TTL_SECONDS = 30;

/**
 * Workiz item types BitCRM has no equivalent for. Both are non-stockable, so
 * they become `service` and the original word is kept in `workizType` — the
 * `assertStockable` guard then treats them the way Workiz did (10 items,
 * 771 job lines). Anything else is rejected as before.
 */
export function normalizeProductType(raw: string): {
  type: ProductType;
  workizType?: string;
} {
  const value = raw.trim().toLowerCase();
  if (KNOWN_PRODUCT_TYPES.includes(value)) {
    return { type: value as ProductType };
  }
  if ((WORKIZ_SERVICE_TYPES as readonly string[]).includes(value)) {
    return { type: ProductType.SERVICE, workizType: value };
  }
  throw new Error(
    `Invalid type (must be "product", "service", "other" or "hours")`,
  );
}

export interface CsvImportResult {
  created: number;
  updated: number;
  errors: Array<{ row: number; message: string }>;
}

/** Who the audit log names for a change. */
interface LogActor {
  userId: string;
  userName: string;
}

/** A write with no request user behind it: internal callers and scripts. */
const SYSTEM_ACTOR: LogActor = { userId: 'system', userName: 'system' };
/** Rows the CSV importer wrote with no signed-in user handed in. */
const CSV_IMPORT_ACTOR: LogActor = { userId: 'system', userName: 'csv-import' };

function logActor(actor: JwtUser | undefined, fallback: LogActor): LogActor {
  return actor ? { userId: actor.id, userName: actor.email } : fallback;
}

/**
 * The keys of `attrs` whose value differs from what the product holds — what
 * an `item_updated` log entry lists. `null` and a missing attribute are the
 * same absence.
 */
export function changedProductFields(existing: Product, attrs: Partial<Product>): string[] {
  const record = existing as unknown as Record<string, unknown>;
  return Object.keys(attrs).filter((key) => {
    const before = JSON.stringify(record[key] ?? null);
    const after = JSON.stringify((attrs as Record<string, unknown>)[key] ?? null);
    return before !== after;
  });
}

/** A custom-field patch as the API takes it: name → value, `null` clears. */
export type CustomAttributesPatch = Record<string, string | null>;

/**
 * An item's custom field values after a patch: each name sent is set, or
 * cleared by `null` / a blank value; every other value the item holds is kept
 * (an imported `workiz_attr_<id>` no definition names any more included).
 * `null` when nothing is left — the attribute is then removed, never stored
 * as an empty map.
 */
export function mergeCustomAttributes(
  current: Record<string, unknown> | null | undefined,
  patch: CustomAttributesPatch,
): Record<string, string> | null {
  const merged: Record<string, string> = {};
  for (const [name, value] of Object.entries(current ?? {})) {
    if (value !== null && value !== undefined) merged[name] = String(value);
  }
  for (const [name, value] of Object.entries(patch)) {
    if (value === null || value.trim() === '') delete merged[name];
    else merged[name] = value;
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

/** Same values whatever the key order; an absent map and an empty one are the same. */
export function sameCustomAttributes(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  const entries = (m: Record<string, unknown> | null | undefined) =>
    JSON.stringify(Object.entries(m ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return entries(a) === entries(b);
}

/**
 * An internal SKU for an item that has none of its own (Workiz lets SKU /
 * Model # stay empty). Built from the item's number; `retry` adds a random
 * tail for the rare clash with a SKU someone typed.
 */
export function internalSku(product: { id: string; number?: number }, retry = false): string {
  const base = `ITEM-${product.number ?? product.id.slice(0, 8)}`;
  return retry ? `${base}-${randomUUID().slice(0, 6)}` : base;
}

/**
 * The importer's stand-in SKU: `WZ-<workiz id>`, written when the Workiz
 * serial was empty, duplicated or too long (the serial itself, if any, is kept
 * in `workizSerial`). Screens show the serial there, as Workiz does.
 */
export function isImporterSku(product: ProductWithExtras): boolean {
  return product.sku.startsWith('WZ-') && product.workizSerial !== product.sku;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly repository: ProductsRepository,
    private readonly cache: ProductsCacheService,
    private readonly s3: S3Service,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly itemCategories?: ItemCategoriesService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly inventoryLog?: InventoryLogService,
    @Optional() private readonly itemAttributes?: ItemAttributesRepository,
  ) {}

  /**
   * Every name a custom-field patch carries must be a field of the catalog
   * (`GET /item-attributes`) — an item edit cannot invent keys. A 400 names
   * the ones that are not.
   */
  private async assertKnownCustomAttributes(patch: CustomAttributesPatch): Promise<void> {
    const names = Object.keys(patch);
    if (names.length === 0 || !this.itemAttributes) return;
    const known = new Set((await this.itemAttributes.listAll()).map((a) => a.name));
    const unknown = names.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown custom field${unknown.length > 1 ? 's' : ''}: ${unknown.map((n) => `"${n}"`).join(', ')}`,
      );
    }
  }

  /** One audit-log line for an item edit; the log itself never throws. */
  private async recordItem(
    action: InventoryLogAction,
    product: Product,
    who: LogActor,
    extra: { changedFields?: string[] } = {},
  ): Promise<void> {
    await this.inventoryLog?.record({
      action,
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      ...who,
      ...extra,
    });
  }

  /**
   * `category` stays required in the API, but the `Uncategorized` sentinel is
   * always accepted: its catalog row is seeded on demand so the picker lists
   * it. A seed failure never fails the product write — the product still
   * carries the name, and the boot-time seed heals the catalog later.
   */
  private async prepareCategory(category: string): Promise<string> {
    const normalized = normalizeCategory(category);
    if (normalized === UNCATEGORIZED_CATEGORY && this.itemCategories) {
      try {
        await this.itemCategories.ensureUncategorized();
      } catch (err) {
        this.logger.warn(
          `Could not seed the "${UNCATEGORIZED_CATEGORY}" category: ${(err as Error).message}`,
        );
      }
    }
    return normalized;
  }

  /**
   * `number` is handed out by the counter and `onHand` by the stock writes;
   * neither is ever taken from a client, whatever the body carries. A new
   * product starts at `onHand: 0` — a row without the attribute is skipped by
   * the stock writes (an ADD would create it as the delta), so the total would
   * never start counting.
   */
  private static stripReadOnly<T extends object>(dto: T): T {
    const { number: _number, onHand: _onHand, ...rest } = dto as T & {
      number?: unknown;
      onHand?: unknown;
    };
    return rest as T;
  }

  async create(dto: CreateProductDto, actor?: JwtUser): Promise<Product> {
    const { customAttributes: patch, ...fields } = ProductsService.stripReadOnly(dto);
    if (patch) await this.assertKnownCustomAttributes(patch);
    const customAttributes = patch ? mergeCustomAttributes(undefined, patch) : null;
    const now = new Date().toISOString();
    const id = randomUUID();
    const number = await this.repository.nextNumber();
    // No SKU of its own (left out or blank): an internal one, marked.
    const generated = !(typeof fields.sku === 'string' && fields.sku.trim());
    let product: Product = {
      id,
      number,
      ...fields,
      sku: generated ? internalSku({ id, number }) : (fields.sku as string),
      ...(generated ? { skuGenerated: true } : {}),
      ...(customAttributes ? { customAttributes } : {}),
      category: await this.prepareCategory(dto.category),
      taxable: dto.taxable ?? true,
      onHand: 0,
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.repository.create(product);
    } catch (error) {
      // A typed SKU that clashes is the caller's 409; an internal one that
      // happens to be taken gets a random tail and one more go.
      if (!generated || !(error instanceof ConflictException)) throw error;
      product = { ...product, sku: internalSku({ id, number }, true) };
      await this.repository.create(product);
    }
    publishInventoryEvent(this.snsPublisher, this.logger, 'product.created', {
      productId: product.id,
    });
    await this.recordItem(InventoryLogAction.ITEM_CREATED, product, logActor(actor, SYSTEM_ACTOR));
    return product;
  }

  async findById(id: string): Promise<Product> {
    const cached = await this.cache.get(id);
    if (cached) return cached;

    const product = await this.repository.findById(id);
    if (!product) {
      throw new NotFoundException(`Product "${id}" not found`);
    }

    await this.cache.set(id, product);
    return product;
  }

  /**
   * One read per product for the stock paths, shared between the guards and
   * the audit log. `assertStockable` and `partitionStockManaged` run back to
   * back on every deduct and every restore; without a shared read that is
   * 2 × GetItem per distinct product. Unlike `findById` this resolves an
   * unknown id to null instead of throwing — stock callers may pass ids this
   * service never persisted.
   *
   * Cache failures degrade to a plain repository read: these paths worked with
   * no Redis dependency at all before, and must keep working if it is down.
   */
  async loadForStock(id: string): Promise<ProductWithExtras | null> {
    try {
      const cached = await this.cache.get(id);
      if (cached) return cached as ProductWithExtras;
    } catch (err) {
      this.logger.warn(
        `Product cache read failed for ${id}: ${(err as Error).message}`,
      );
    }

    const product = await this.repository.findById(id);
    if (product) {
      try {
        await this.cache.set(id, product);
      } catch (err) {
        this.logger.warn(
          `Product cache write failed for ${id}: ${(err as Error).message}`,
        );
      }
    }
    return product as ProductWithExtras | null;
  }

  /**
   * Guard for stock operations. Services are non-stockable, so they may never be
   * received into a warehouse, transferred between locations, or moved through a
   * technician's container. Unknown product ids are ignored (callers may pass ids
   * not persisted here) — only confirmed service-type products are rejected.
   */
  async assertStockable(productIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(productIds)];
    const serviceNames: string[] = [];
    for (const id of uniqueIds) {
      const product = await this.loadForStock(id);
      if (product?.type === ProductType.SERVICE) {
        serviceNames.push(product.name);
      }
    }
    if (serviceNames.length > 0) {
      this.logger.warn(
        `Rejected stock operation for service-type product(s): ${serviceNames.join(', ')}`,
      );
      throw new BadRequestException(
        `Services cannot be stocked or transferred: ${serviceNames.join(', ')}`,
      );
    }
  }

  /**
   * Workiz decides stock tracking per item (`manage`), BitCRM per type: 6 643
   * product-type items have `manage = 0`, and deducting one would either fail
   * with "Insufficient stock" or invent a negative-looking row for stock the
   * business never counted.
   *
   * A product is stock-managed unless its stored row says `manageStock` is
   * exactly `false`. Everything BitCRM has written carries no such attribute,
   * so this changes nothing for existing data.
   *
   * Shares `loadForStock` with `assertStockable`, which always runs
   * first, so the product is fetched once per movement rather than twice.
   */
  async isStockManaged(productId: string): Promise<boolean> {
    const product = await this.loadForStock(productId);
    return product?.manageStock !== false;
  }

  /**
   * Split stock-movement items into the ones that move a counter and the ones
   * the price book says are not tracked. Each product is looked up once.
   */
  async partitionStockManaged<T extends { productId: string }>(
    items: T[],
  ): Promise<{ managed: T[]; unmanaged: T[] }> {
    const decided = new Map<string, boolean>();
    const managed: T[] = [];
    const unmanaged: T[] = [];
    for (const item of items) {
      let isManaged = decided.get(item.productId);
      if (isManaged === undefined) {
        isManaged = await this.isStockManaged(item.productId);
        decided.set(item.productId, isManaged);
      }
      (isManaged ? managed : unmanaged).push(item);
    }
    return { managed, unmanaged };
  }

  async findBySku(sku: string): Promise<Product> {
    const product = await this.repository.findBySku(sku);
    if (!product) {
      throw new NotFoundException(`Product with SKU "${sku}" not found`);
    }
    return product;
  }

  async findAll(limit: number, cursor?: string) {
    return this.repository.findAll(limit, cursor);
  }

  /**
   * Category picks the CategoryIndex; else `manageStock=true` picks the
   * stock-managed partition (Workiz's "inventory products", name order);
   * else the Price Book partition — every item, name order — is read. Every
   * other given filter (type included) is applied on top, so Workiz's
   * combinable filters ("this category, active, stock-managed") hold. The
   * public list never Scans the shared table any more; `findAll` is left to
   * the search indexer's internal walk.
   */
  async list(query: ListProductsQueryDto) {
    const { category, type, search, status, brandId, manageStock, stockLevel, limit = 20, cursor } = query;
    const filters: ProductListFilters = { type, status, search, brandId, manageStock, stockLevel };

    if (category) {
      return this.repository.findByCategory(category, limit, cursor, filters);
    }
    if (manageStock === true) {
      return this.repository.findStockManaged(limit, cursor, { type, status, search, brandId, stockLevel });
    }
    return this.repository.findCatalog(limit, cursor, filters);
  }

  /**
   * How many products the current filters select — the number behind
   * "Page 2 of 7".
   *
   * It branches exactly as `list` does, or the panel would size itself against
   * a different population than the rows under it. Behind a short cache: the
   * count outlives a page load, and flipping filters back and forth should not
   * re-walk the table.
   */
  async count(query: ListProductsQueryDto): Promise<ListCount> {
    const { category, type, search, status, brandId, manageStock, stockLevel } = query;
    const filters: ProductListFilters = { type, status, search, brandId, manageStock, stockLevel };

    const take = () => {
      if (category) return this.repository.countByCategory(category, filters);
      if (manageStock === true) {
        return this.repository.countStockManaged({ type, status, search, brandId, stockLevel });
      }
      return this.repository.countCatalog(filters);
    };

    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('products', { category, type, search, status, brandId, manageStock, stockLevel }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  /**
   * The SKU part of an edit; answers whether the SKU itself changed.
   * - the same SKU: nothing;
   * - another SKU: the claim moves (a taken one is a 409) and an internal
   *   mark is cleared;
   * - blank: the item keeps an internal SKU it already has (the importer's
   *   `WZ-…` included), only marked; one the user had typed is replaced by a
   *   new internal SKU.
   */
  private async applySku(existing: Product, next: string): Promise<boolean> {
    if (next === existing.sku) return false;
    if (next) {
      await this.repository.changeSku(existing.id, existing.sku, next);
      return true;
    }
    if (existing.skuGenerated || isImporterSku(existing as ProductWithExtras)) {
      if (!existing.skuGenerated) await this.repository.update(existing.id, { skuGenerated: true });
      return false;
    }
    try {
      await this.repository.changeSku(existing.id, existing.sku, internalSku(existing), { generated: true });
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      await this.repository.changeSku(existing.id, existing.sku, internalSku(existing, true), { generated: true });
    }
    return true;
  }

  async update(id: string, dto: UpdateProductDto, actor?: JwtUser): Promise<Product> {
    const { product, changedFields } = await this.applyUpdate(id, dto);
    // An edit that changed nothing is not a line in the log.
    if (changedFields.length > 0) {
      await this.recordItem(InventoryLogAction.ITEM_UPDATED, product, logActor(actor, SYSTEM_ACTOR), {
        changedFields,
      });
    }
    return product;
  }

  /**
   * The write behind update, archive and reactivate, answering which of the
   * given fields differ from what was stored — compared after the category
   * normalisation, so "uncategorized" over "Uncategorized" is no change.
   */
  private async applyUpdate(
    id: string,
    dto: UpdateProductDto,
  ): Promise<{ product: Product; changedFields: string[] }> {
    const existing = await this.findById(id); // Ensure exists
    const { customAttributes: patch, sku, ...fields } = ProductsService.stripReadOnly(dto);
    const attrs: Partial<Product> = { ...fields };
    // A new SKU moves the product's SKU claim first, so a SKU another item
    // holds is refused (409) before anything else is written. The same SKU
    // sent back is no change. A blank one means "no SKU of its own", as an
    // emptied Workiz SKU / Model # does: an internal SKU, marked.
    const skuChanged = typeof sku === 'string' ? await this.applySku(existing, sku.trim()) : false;
    if (patch !== undefined) {
      // A patch, merged over what the item holds: the values it does not name
      // are kept. Written only when something actually changes; nothing left
      // is `null`, which removes the attribute.
      await this.assertKnownCustomAttributes(patch);
      const merged = mergeCustomAttributes(existing.customAttributes, patch);
      if (!sameCustomAttributes(existing.customAttributes, merged)) {
        attrs.customAttributes = merged as Product['customAttributes'];
      }
    }
    if (typeof dto.category === 'string') {
      attrs.category = await this.prepareCategory(dto.category);
    }
    const product = await this.repository.update(id, attrs);
    await this.cache.invalidate(id);
    publishInventoryEvent(this.snsPublisher, this.logger, 'product.updated', {
      productId: id,
    });
    const changedFields = changedProductFields(existing, attrs);
    return { product, changedFields: skuChanged ? ['sku', ...changedFields] : changedFields };
  }

  async archive(id: string, actor?: JwtUser): Promise<Product> {
    const { product } = await this.applyUpdate(id, { status: InventoryStatus.ARCHIVED } as any);
    await this.recordItem(InventoryLogAction.ITEM_ARCHIVED, product, logActor(actor, SYSTEM_ACTOR));
    return product;
  }

  async reactivate(id: string, actor?: JwtUser): Promise<Product> {
    const { product } = await this.applyUpdate(id, { status: InventoryStatus.ACTIVE } as any);
    await this.recordItem(InventoryLogAction.ITEM_RESTORED, product, logActor(actor, SYSTEM_ACTOR));
    return product;
  }

  async findByBarcode(barcode: string): Promise<Product> {
    const product = await this.repository.findByBarcode(barcode);
    if (!product) {
      throw new NotFoundException(`Product with barcode "${barcode}" not found`);
    }
    return product;
  }

  async removePhoto(id: string): Promise<Product> {
    const product = await this.findById(id);
    if (product.photoKey) {
      await this.s3.deleteObject(product.photoKey).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Failed to delete photo object for ${id}: ${msg}`);
      });
    }
    const updated = await this.repository.update(id, { photoKey: undefined });
    await this.cache.invalidate(id);
    return updated;
  }

  async getPhotoUploadUrl(
    id: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    await this.findById(id); // Ensure exists

    const ext = contentType === 'image/png' ? 'png' : 'jpg';
    const key = `products/${id}/${randomUUID()}.${ext}`;

    const uploadUrl = await this.s3.getPresignedUploadUrl(key, contentType);
    await this.repository.update(id, { photoKey: key } as any);
    await this.cache.invalidate(id);

    return { uploadUrl, key };
  }

  async getPhotoDownloadUrl(id: string): Promise<{ downloadUrl: string }> {
    const product = await this.findById(id);
    if (!product.photoKey) {
      throw new NotFoundException('Product has no photo');
    }

    const downloadUrl = await this.s3.getPresignedDownloadUrl(product.photoKey);
    return { downloadUrl };
  }

  async importFromCsv(
    buffer: Buffer,
    dryRun = false,
    actor?: JwtUser,
  ): Promise<CsvImportResult> {
    const result: CsvImportResult = { created: 0, updated: 0, errors: [] };
    const who = logActor(actor, CSV_IMPORT_ACTOR);

    let records: any[];
    try {
      records = parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      this.logger.warn('CSV import failed: invalid CSV format');
      result.errors.push({ row: 0, message: 'Invalid CSV format' });
      return result;
    }

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2; // 1-indexed + header row

      try {
        const validation = this.validateCsvRow(row);
        if (validation) {
          result.errors.push({ row: rowNum, message: validation });
          continue;
        }

        const existing = await this.repository.findBySku(row.sku);
        const { type, workizType } = normalizeProductType(row.type);
        const category = dryRun
          ? normalizeCategory(row.category)
          : await this.prepareCategory(row.category);
        const taxable = this.parseCsvBoolean(row.taxable);

        if (existing) {
          if (!dryRun) {
            const attrs: Partial<Product> = {
              name: row.name,
              category,
              type,
              // Explicit `undefined` REMOVEs the attribute (see
              // ProductsRepository.update) — re-importing an `other` row as a
              // plain `product` must not leave the stale Workiz word behind,
              // or the item list keeps rendering "Product · other".
              workizType: workizType ?? undefined,
              costCompany: parseFloat(row.costCompany),
              costTech: parseFloat(row.costTech),
              priceClient: parseFloat(row.priceClient),
              serialTracking: row.serialTracking === 'true',
              minimumStockLevel: parseInt(row.minimumStockLevel, 10),
              // A blank cell leaves the stored flag alone.
              ...(taxable !== undefined && { taxable }),
              ...(row.supplier && { supplier: row.supplier }),
              ...(row.barcode && { barcode: row.barcode }),
              ...(row.description && { description: row.description }),
            };
            await this.repository.update(existing.id, attrs);
            await this.cache.invalidate(existing.id);
            const changedFields = changedProductFields(existing, attrs);
            if (changedFields.length > 0) {
              await this.recordItem(
                InventoryLogAction.ITEM_UPDATED,
                { ...existing, ...attrs },
                who,
                { changedFields },
              );
            }
          }
          result.updated++;
        } else {
          if (!dryRun) {
            const now = new Date().toISOString();
            const product: Product = {
              id: randomUUID(),
              number: await this.repository.nextNumber(),
              sku: row.sku,
              name: row.name,
              category,
              type,
              ...(workizType && { workizType }),
              costCompany: parseFloat(row.costCompany),
              costTech: parseFloat(row.costTech),
              priceClient: parseFloat(row.priceClient),
              serialTracking: row.serialTracking === 'true',
              minimumStockLevel: parseInt(row.minimumStockLevel, 10),
              taxable: taxable ?? true,
              supplier: row.supplier || undefined,
              barcode: row.barcode || undefined,
              description: row.description || undefined,
              onHand: 0,
              status: InventoryStatus.ACTIVE,
              createdAt: now,
              updatedAt: now,
            };
            await this.repository.create(product);
            await this.recordItem(InventoryLogAction.ITEM_CREATED, product, who);
          }
          result.created++;
        }
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`CSV import row ${rowNum} failed: ${msg}`);
        result.errors.push({ row: rowNum, message: msg });
      }
    }

    this.logger.log(
      `CSV import completed: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`,
    );
    return result;
  }

  private validateCsvRow(
    row: Record<string, string>,
  ): string | null {
    if (!row.name) return 'Missing name';
    if (!row.sku) return 'Missing sku';
    if (!row.category) return 'Missing category';
    if (!row.type) {
      return 'Invalid type (must be "product", "service", "other" or "hours")';
    }
    try {
      // `other` / `hours` are accepted and land as `service` (see
      // normalizeProductType) so a Workiz export round-trips through the CSV.
      normalizeProductType(row.type);
    } catch (err) {
      return (err as Error).message;
    }
    if (!row.costCompany || isNaN(parseFloat(row.costCompany))) {
      return 'Invalid costCompany';
    }
    if (!row.costTech || isNaN(parseFloat(row.costTech))) {
      return 'Invalid costTech';
    }
    if (!row.priceClient || isNaN(parseFloat(row.priceClient))) {
      return 'Invalid priceClient';
    }
    if (row.taxable && this.parseCsvBoolean(row.taxable) === undefined) {
      return 'Invalid taxable (use true/false, yes/no or 1/0)';
    }
    return null;
  }

  /** Optional CSV boolean cell: blank/absent → undefined (also for junk; validated above). */
  private parseCsvBoolean(value: string | undefined): boolean | undefined {
    const v = value?.trim().toLowerCase();
    if (v === 'true' || v === 'yes' || v === '1') return true;
    if (v === 'false' || v === 'no' || v === '0') return false;
    return undefined;
  }
}
