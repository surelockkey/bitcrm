import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { type ProductCategory, UNCATEGORIZED_CATEGORY } from '@bitcrm/types';
import { createHash, randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import { ItemCategoriesRepository } from './item-categories.repository';
import { ProductCategoryMover } from '../products/product-category-mover';
import { type CreateItemCategoryDto } from './dto/create-item-category.dto';
import { type UpdateItemCategoryDto } from './dto/update-item-category.dto';

/**
 * The id a name-seeded category gets. It must be **deterministic**: the
 * repository's `create` guards with `attribute_not_exists(PK)` and the PK is
 * `ITEM_CATEGORY#<id>`, so a `randomUUID()` here could never collide and the
 * guard could never fire. Two writers seeding the same name would both
 * succeed — and `UncategorizedCategorySeed.onModuleInit` runs on *every*
 * service instance, so the first multi-task deploy after the import would mint
 * one duplicate "Uncategorized" row per task. Duplicates are then stuck:
 * `assertNameAvailable` 409s any rename of either, and `findByName` (`Limit:
 * 1`) resolves to an arbitrary one.
 *
 * With a name-derived id both writers aim at the same PK, the loser gets a
 * ConditionalCheckFailedException and re-reads the winner's row.
 *
 * RFC 4122 v5 shape (SHA-1, name-based) over the trimmed, lowercased name in a
 * fixed BitCRM namespace, so the id is still a well-formed UUID.
 */
const SEEDED_CATEGORY_NAMESPACE = 'bitcrm:item-category:';

/** The no-category sentinel, in any casing or padding. */
function isUncategorized(name: string): boolean {
  return name.trim().toLowerCase() === UNCATEGORIZED_CATEGORY.toLowerCase();
}

export function seededCategoryId(name: string): string {
  const h = createHash('sha1')
    .update(SEEDED_CATEGORY_NAMESPACE + name.trim().toLowerCase(), 'utf8')
    .digest('hex');
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `${variant}${h.slice(18, 20)}`,
    h.slice(20, 32),
  ].join('-');
}

@Injectable()
export class ItemCategoriesService {
  private readonly logger = new Logger(ItemCategoriesService.name);

  constructor(
    private readonly repository: ItemCategoriesRepository,
    private readonly productMover: ProductCategoryMover,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  /** Names are the picker-facing identity — duplicates would be indistinguishable. */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (c) => c.id !== excludeId && c.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A category named "${clash.name}" already exists`);
    }
  }

  async create(dto: CreateItemCategoryDto, caller: { id: string }): Promise<ProductCategory> {
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const category: ProductCategory = {
      id: randomUUID(),
      name: dto.name,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(category);
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-category.created', {
      categoryId: category.id,
      name: category.name,
    });
    return category;
  }

  /**
   * Make sure a catalog row with this name exists (case-insensitive), creating
   * it when missing. Used for the `Uncategorized` sentinel that imported and
   * uncategorized items reference by name — the picker must list it and the
   * archive-on-delete rule must resolve it. Idempotent: an existing row (active
   * or archived) is returned untouched; a concurrent create is re-read.
   *
   * The id is derived from the name (`seededCategoryId`) so that concurrent
   * callers collide on one PK instead of each writing their own duplicate.
   */
  async ensureCategory(
    name: string,
    createdBy = 'system',
  ): Promise<{ category: ProductCategory; created: boolean }> {
    const existing = await this.repository.findByName(name);
    if (existing) return { category: existing, created: false };

    const now = new Date().toISOString();
    const category: ProductCategory = {
      id: seededCategoryId(name),
      name,
      active: true,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.repository.create(category);
    } catch (err) {
      // Lost the race for this PK — the winner's row is there now, use it.
      // `findByName` reads GSI1, which is eventually consistent, so fall back
      // to a base-table read at the id we just tried to claim.
      const raced =
        (await this.repository.findByName(name)) ??
        (await this.repository.get(category.id));
      if (raced) return { category: raced, created: false };
      throw err;
    }
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-category.created', {
      categoryId: category.id,
      name: category.name,
    });
    return { category, created: true };
  }

  /** The `Uncategorized` sentinel row, seeded on first demand. */
  ensureUncategorized(): Promise<{ category: ProductCategory; created: boolean }> {
    return this.ensureCategory(UNCATEGORIZED_CATEGORY);
  }

  async list(): Promise<ProductCategory[]> {
    const categories = await this.repository.listAll();
    return categories.sort((a, b) => a.name.localeCompare(b.name));
  }

  async findById(id: string): Promise<ProductCategory> {
    const category = await this.repository.get(id);
    if (!category) throw new NotFoundException(`Item category ${id} not found`);
    return category;
  }

  /**
   * A rename moves the category's items too: they store it by NAME, byte for
   * byte, so any change of the stored string — case and padding included —
   * is a rename. The items move first and the row is saved after, so a move
   * that fails half-way is finished by sending the same rename again.
   * `Uncategorized` is the sentinel items without a category carry: it is
   * never renamed, and no category is renamed into it. `movedItems` says how
   * many items moved (0 when the name did not change).
   */
  async update(
    id: string,
    dto: UpdateItemCategoryDto,
    _caller: { id: string },
  ): Promise<ProductCategory & { movedItems: number }> {
    const existing = await this.findById(id);
    const renamed = dto.name !== undefined && dto.name !== existing.name;
    if (renamed && isUncategorized(existing.name)) {
      throw new BadRequestException(
        `"${UNCATEGORIZED_CATEGORY}" holds the items without a category and cannot be renamed`,
      );
    }
    if (renamed && isUncategorized(dto.name!)) {
      throw new BadRequestException(`"${UNCATEGORIZED_CATEGORY}" is reserved for items without a category`);
    }
    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const movedItems = renamed ? await this.productMover.move(existing.name, dto.name!) : 0;

    const updated: ProductCategory = {
      ...existing,
      name: dto.name ?? existing.name,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-category.updated', {
      categoryId: id,
      name: updated.name,
      ...(renamed && { previousName: existing.name, movedItems }),
    });
    return { ...updated, movedItems };
  }

  /**
   * Archive rather than destroy when items still use the category name —
   * otherwise their category cell would dangle. Unreferenced categories are
   * removed outright. Returns which happened so the UI can word its toast.
   */
  async remove(id: string, caller: { id: string }): Promise<{ archived: boolean }> {
    const existing = await this.findById(id);

    if (await this.repository.isReferencedByProduct(existing.name)) {
      if (existing.active) {
        await this.repository.put({
          ...existing,
          active: false,
          updatedAt: new Date().toISOString(),
        });
      }
      publishInventoryEvent(this.snsPublisher, this.logger, 'item-category.archived', {
        categoryId: id,
        archivedBy: caller.id,
      });
      this.logger.log(`Archived item category ${id} — still referenced by an item`);
      return { archived: true };
    }

    await this.repository.remove(id);
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-category.deleted', {
      categoryId: id,
      deletedBy: caller.id,
    });
    return { archived: false };
  }
}
