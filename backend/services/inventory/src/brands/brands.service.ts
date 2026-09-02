import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { type Brand } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import { BrandsRepository } from './brands.repository';
import { type CreateBrandDto } from './dto/create-brand.dto';
import { type UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  private readonly logger = new Logger(BrandsService.name);

  constructor(
    private readonly repository: BrandsRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (b) => b.id !== excludeId && b.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A brand named "${clash.name}" already exists`);
    }
  }

  async create(dto: CreateBrandDto, caller: { id: string }): Promise<Brand> {
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const brand: Brand = {
      id: randomUUID(),
      name: dto.name,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(brand);
    publishInventoryEvent(this.snsPublisher, this.logger, 'brand.created', {
      brandId: brand.id,
      name: brand.name,
    });
    return brand;
  }

  async list(): Promise<Brand[]> {
    const brands = await this.repository.listAll();
    return brands.sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<Brand> {
    const brand = await this.repository.get(id);
    if (!brand) throw new NotFoundException(`Brand ${id} not found`);
    return brand;
  }

  async update(id: string, dto: UpdateBrandDto, _caller: { id: string }): Promise<Brand> {
    const existing = await this.findById(id);
    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const updated: Brand = {
      ...existing,
      name: dto.name ?? existing.name,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    publishInventoryEvent(this.snsPublisher, this.logger, 'brand.updated', {
      brandId: id,
      name: updated.name,
    });
    return updated;
  }

  /**
   * Items don't store a brand yet, so nothing can reference one — delete
   * outright. When items grow a brand field, mirror the category
   * archive-when-referenced flow here.
   */
  async remove(id: string, caller: { id: string }): Promise<{ archived: boolean }> {
    await this.findById(id);
    await this.repository.remove(id);
    publishInventoryEvent(this.snsPublisher, this.logger, 'brand.deleted', {
      brandId: id,
      deletedBy: caller.id,
    });
    return { archived: false };
  }
}
