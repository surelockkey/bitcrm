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
import { type WithDescription } from '../common/decorators/catalog-description.decorator';

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

  async create(dto: CreateBrandDto, caller: { id: string }): Promise<WithDescription<Brand>> {
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const brand: WithDescription<Brand> = {
      id: randomUUID(),
      name: dto.name,
      active: dto.active ?? true,
      ...(dto.description && { description: dto.description }),
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

  /** Name, active and description — whatever is sent; '' clears the description. */
  async update(id: string, dto: UpdateBrandDto, _caller: { id: string }): Promise<WithDescription<Brand>> {
    const existing: WithDescription<Brand> = await this.findById(id);
    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const updated: WithDescription<Brand> = {
      ...existing,
      name: dto.name ?? existing.name,
      active: dto.active ?? existing.active,
      ...(dto.description !== undefined && { description: dto.description }),
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
   * Archive rather than destroy while any item still names the brand
   * (`Product.brandId`) — its brand cell and the brand filter would dangle
   * otherwise. An unused brand is removed outright. Returns which happened so
   * the UI can word its toast.
   */
  async remove(id: string, caller: { id: string }): Promise<{ archived: boolean }> {
    const existing = await this.findById(id);

    if (await this.repository.isReferencedByProduct(id)) {
      if (existing.active) {
        await this.repository.put({ ...existing, active: false, updatedAt: new Date().toISOString() });
      }
      publishInventoryEvent(this.snsPublisher, this.logger, 'brand.archived', {
        brandId: id,
        archivedBy: caller.id,
      });
      this.logger.log(`Archived brand ${id} — still used by an item`);
      return { archived: true };
    }

    await this.repository.remove(id);
    publishInventoryEvent(this.snsPublisher, this.logger, 'brand.deleted', {
      brandId: id,
      deletedBy: caller.id,
    });
    return { archived: false };
  }
}
