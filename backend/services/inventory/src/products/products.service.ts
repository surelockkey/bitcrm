import {
  BadRequestException,
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
  ProductType,
  InventoryStatus,
  UNCATEGORIZED_CATEGORY,
  WORKIZ_SERVICE_TYPES,
} from '@bitcrm/types';
import { ProductsRepository } from './products.repository';
import { ProductsCacheService } from './products-cache.service';
import { S3Service, SnsPublisherService } from '@bitcrm/shared';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import { ItemCategoriesService } from '../item-categories/item-categories.service';
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

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly repository: ProductsRepository,
    private readonly cache: ProductsCacheService,
    private readonly s3: S3Service,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly itemCategories?: ItemCategoriesService,
  ) {}

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

  async create(dto: CreateProductDto): Promise<Product> {
    const now = new Date().toISOString();
    const product: Product = {
      id: randomUUID(),
      ...dto,
      category: await this.prepareCategory(dto.category),
      taxable: dto.taxable ?? true,
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(product);
    publishInventoryEvent(this.snsPublisher, this.logger, 'product.created', {
      productId: product.id,
    });
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
   * One read per product for the stock guards, shared between them.
   * `assertStockable` and `partitionStockManaged` run back to back on every
   * deduct and every restore; without a shared read that is 2 × GetItem per
   * distinct product. Unlike `findById` this resolves an unknown id to null
   * instead of throwing — stock callers may pass ids this service never
   * persisted.
   *
   * Cache failures degrade to a plain repository read: these paths worked with
   * no Redis dependency at all before, and must keep working if it is down.
   */
  private async loadForStockGuard(id: string): Promise<ProductWithExtras | null> {
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
      const product = await this.loadForStockGuard(id);
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
   * Shares `loadForStockGuard` with `assertStockable`, which always runs
   * first, so the product is fetched once per movement rather than twice.
   */
  async isStockManaged(productId: string): Promise<boolean> {
    const product = await this.loadForStockGuard(productId);
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

  async list(query: ListProductsQueryDto) {
    const { category, type, search, status, limit = 20, cursor } = query;

    if (category) {
      return this.repository.findByCategory(category, limit, cursor);
    }
    if (type) {
      return this.repository.findByType(type, limit, cursor);
    }

    return this.repository.findAll(limit, cursor, { status, search });
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    await this.findById(id); // Ensure exists
    const attrs: Partial<Product> = { ...dto };
    if (typeof dto.category === 'string') {
      attrs.category = await this.prepareCategory(dto.category);
    }
    const product = await this.repository.update(id, attrs);
    await this.cache.invalidate(id);
    publishInventoryEvent(this.snsPublisher, this.logger, 'product.updated', {
      productId: id,
    });
    return product;
  }

  async archive(id: string): Promise<Product> {
    return this.update(id, { status: InventoryStatus.ARCHIVED } as any);
  }

  async reactivate(id: string): Promise<Product> {
    return this.update(id, { status: InventoryStatus.ACTIVE } as any);
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

  async importFromCsv(buffer: Buffer, dryRun = false): Promise<CsvImportResult> {
    const result: CsvImportResult = { created: 0, updated: 0, errors: [] };

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
            await this.repository.update(existing.id, {
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
            });
            await this.cache.invalidate(existing.id);
          }
          result.updated++;
        } else {
          if (!dryRun) {
            const now = new Date().toISOString();
            await this.repository.create({
              id: randomUUID(),
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
              status: InventoryStatus.ACTIVE,
              createdAt: now,
              updatedAt: now,
            });
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
