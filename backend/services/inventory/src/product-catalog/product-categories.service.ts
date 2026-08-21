import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InventoryStatus,
  type ProductCategory,
  type ProductCategoryWithCounts,
} from '@bitcrm/types';
import { ProductCategoriesRepository } from './product-categories.repository';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';

@Injectable()
export class ProductCategoriesService {
  constructor(private readonly repository: ProductCategoriesRepository) {}

  async create(dto: CreateProductCategoryDto): Promise<ProductCategory> {
    await this.assertNameIsFree(dto.name);
    if (dto.parentId) await this.assertParentExists(dto.parentId);

    const now = new Date().toISOString();
    const category: ProductCategory = {
      id: randomUUID(),
      name: dto.name.trim(),
      ...(dto.description && { description: dto.description }),
      ...(dto.photoKey && { photoKey: dto.photoKey }),
      ...(dto.parentId && { parentId: dto.parentId }),
      status: InventoryStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(category);
    return category;
  }

  async findById(id: string): Promise<ProductCategory> {
    const category = await this.repository.findById(id);
    if (!category) {
      throw new NotFoundException(`Product category "${id}" not found`);
    }
    return category;
  }

  async update(
    id: string,
    dto: UpdateProductCategoryDto,
  ): Promise<ProductCategory> {
    const existing = await this.findById(id);

    if (dto.name && dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameIsFree(dto.name);
    }

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.assertParentExists(dto.parentId);
      await this.assertNotADescendant(id, dto.parentId);
    }

    return this.repository.update(id, {
      ...(dto.name && { name: dto.name.trim() }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.photoKey !== undefined && { photoKey: dto.photoKey }),
      ...(dto.parentId !== undefined && { parentId: dto.parentId ?? undefined }),
    });
  }

  /**
   * Archiving a category takes its whole subtree with it — Workiz warns that
   * disabling a category disables everything nested inside, and a live
   * subcategory under an archived parent would be unreachable in the UI anyway.
   *
   * Products still carry a free-text `category`, so they are not cascaded yet;
   * that needs the product -> categoryId migration first.
   */
  async archive(id: string): Promise<ProductCategory[]> {
    await this.findById(id);
    const all = await this.repository.findAll();
    const ids = this.collectSubtree(id, all);

    return Promise.all(
      ids.map((categoryId) =>
        this.repository.update(categoryId, {
          status: InventoryStatus.ARCHIVED,
        }),
      ),
    );
  }

  async reactivate(id: string): Promise<ProductCategory> {
    await this.findById(id);
    return this.repository.update(id, { status: InventoryStatus.ACTIVE });
  }

  /** Rows for the settings table: parent name resolved, item counts attached. */
  async listWithCounts(): Promise<ProductCategoryWithCounts[]> {
    const all = await this.repository.findAll();
    const nameById = new Map(all.map((c) => [c.id, c.name]));

    return all.map((category) => ({
      ...category,
      ...(category.parentId && {
        parentName: nameById.get(category.parentId),
      }),
      // Products are still filed by free-text category name, so this stays 0
      // until the product -> categoryId migration lands.
      activeItemCount: 0,
    }));
  }

  /** The category plus every category beneath it, at any depth. */
  private collectSubtree(rootId: string, all: ProductCategory[]): string[] {
    const childrenByParent = new Map<string, string[]>();
    for (const category of all) {
      if (!category.parentId) continue;
      const siblings = childrenByParent.get(category.parentId) ?? [];
      siblings.push(category.id);
      childrenByParent.set(category.parentId, siblings);
    }

    const collected: string[] = [];
    const queue = [rootId];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      collected.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }

    return collected;
  }

  private async assertNameIsFree(name: string): Promise<void> {
    if (await this.repository.findByName(name)) {
      throw new ConflictException(
        `A category named "${name.trim()}" already exists`,
      );
    }
  }

  private async assertParentExists(parentId: string): Promise<void> {
    if (!(await this.repository.findById(parentId))) {
      throw new BadRequestException(`Parent category "${parentId}" not found`);
    }
  }

  /** Re-parenting a category under its own descendant would detach the subtree. */
  private async assertNotADescendant(
    id: string,
    candidateParentId: string,
  ): Promise<void> {
    const all = await this.repository.findAll();
    if (this.collectSubtree(id, all).includes(candidateParentId)) {
      throw new BadRequestException(
        'A category cannot be moved under one of its own subcategories',
      );
    }
  }
}
