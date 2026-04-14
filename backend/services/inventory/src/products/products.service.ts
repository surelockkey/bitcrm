import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import { type Product, ProductType, InventoryStatus } from '@bitcrm/types';
import { ProductsRepository } from './products.repository';
import { ProductsCacheService } from './products-cache.service';
import { S3Service } from '../common/s3/s3.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';

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
  ) {}

  async create(dto: CreateProductDto): Promise<Product> {
    const now = new Date().toISOString();
    const product: Product = {
      id: randomUUID(),
      ...dto,
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(product);
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

  async findBySku(sku: string): Promise<Product> {
    const product = await this.repository.findBySku(sku);
    if (!product) {
      throw new NotFoundException(`Product with SKU "${sku}" not found`);
    }
    return product;
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
    const product = await this.repository.update(id, dto);
    await this.cache.invalidate(id);
    return product;
  }

  async archive(id: string): Promise<Product> {
    return this.update(id, { status: InventoryStatus.ARCHIVED } as any);
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

  async importFromCsv(buffer: Buffer): Promise<CsvImportResult> {
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

        if (existing) {
          await this.repository.update(existing.id, {
            name: row.name,
            category: row.category,
            type: row.type as ProductType,
            costCompany: parseFloat(row.costCompany),
            costTech: parseFloat(row.costTech),
            priceClient: parseFloat(row.priceClient),
            serialTracking: row.serialTracking === 'true',
            minimumStockLevel: parseInt(row.minimumStockLevel, 10),
            ...(row.supplier && { supplier: row.supplier }),
            ...(row.barcode && { barcode: row.barcode }),
            ...(row.description && { description: row.description }),
          });
          await this.cache.invalidate(existing.id);
          result.updated++;
        } else {
          const now = new Date().toISOString();
          await this.repository.create({
            id: randomUUID(),
            sku: row.sku,
            name: row.name,
            category: row.category,
            type: row.type as ProductType,
            costCompany: parseFloat(row.costCompany),
            costTech: parseFloat(row.costTech),
            priceClient: parseFloat(row.priceClient),
            serialTracking: row.serialTracking === 'true',
            minimumStockLevel: parseInt(row.minimumStockLevel, 10),
            supplier: row.supplier || undefined,
            barcode: row.barcode || undefined,
            description: row.description || undefined,
            status: InventoryStatus.ACTIVE,
            createdAt: now,
            updatedAt: now,
          });
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
    if (!row.type || !['product', 'service'].includes(row.type)) {
      return 'Invalid type (must be "product" or "service")';
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
    return null;
  }
}
