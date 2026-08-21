import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InventoryStatus, type Brand } from '@bitcrm/types';
import { BrandsRepository } from './brands.repository';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandsService {
  constructor(private readonly repository: BrandsRepository) {}

  async create(dto: CreateBrandDto): Promise<Brand> {
    await this.assertNameIsFree(dto.name);

    const now = new Date().toISOString();
    const brand: Brand = {
      id: randomUUID(),
      name: dto.name.trim(),
      ...(dto.description && { description: dto.description }),
      ...(dto.photoKey && { photoKey: dto.photoKey }),
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(brand);
    return brand;
  }

  async findAll(): Promise<Brand[]> {
    return this.repository.findAll();
  }

  async findById(id: string): Promise<Brand> {
    const brand = await this.repository.findById(id);
    if (!brand) throw new NotFoundException(`Brand "${id}" not found`);
    return brand;
  }

  async update(id: string, dto: UpdateBrandDto): Promise<Brand> {
    const existing = await this.findById(id);

    if (dto.name && dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameIsFree(dto.name);
    }

    return this.repository.update(id, {
      ...(dto.name && { name: dto.name.trim() }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.photoKey !== undefined && { photoKey: dto.photoKey }),
    });
  }

  /** Brands are archived, never deleted — products keep pointing at them. */
  async archive(id: string): Promise<Brand> {
    await this.findById(id);
    return this.repository.update(id, { status: InventoryStatus.ARCHIVED });
  }

  async reactivate(id: string): Promise<Brand> {
    await this.findById(id);
    return this.repository.update(id, { status: InventoryStatus.ACTIVE });
  }

  private async assertNameIsFree(name: string): Promise<void> {
    if (await this.repository.findByName(name)) {
      throw new ConflictException(
        `A brand named "${name.trim()}" already exists`,
      );
    }
  }
}
