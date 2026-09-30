import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { type ItemAttribute } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import { ProductsCacheService } from '../products/products-cache.service';
import { ItemAttributesRepository, type ProductAttributeRow } from './item-attributes.repository';
import {
  ITEM_ATTRIBUTE_RESOURCE,
  ITEM_ATTRIBUTE_WRITE_CONCURRENCY,
  NAME_IN_USE_MESSAGE,
} from './item-attributes.constants';
import { type CreateItemAttributeDto } from './dto/create-item-attribute.dto';
import { type UpdateItemAttributeDto } from './dto/update-item-attribute.dto';

/** What a rename or delete did to the items. */
export interface ItemAttributeProductsResult {
  /** Items whose value was moved (rename) or removed (delete). */
  productsUpdated: number;
  /**
   * Items left as they were: on a rename, one that already held a value under
   * the new name (kept, not overwritten); or one changed by another write
   * between the read and this one.
   */
  productsSkipped: number;
}

/** `workiz:attribute:5297` → 5297; anything else sorts after the imported ones. */
function workizOrder(attribute: ItemAttribute): number {
  const match = /^workiz:attribute:(\d+)$/.exec(attribute.externalId ?? '');
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Workiz lists custom fields in the order they were made (by id). Imported
 * definitions carry that id in `externalId`; ones made here follow them in
 * creation order.
 */
export function sortItemAttributes(list: ItemAttribute[]): ItemAttribute[] {
  return [...list].sort((a, b) => {
    const wa = workizOrder(a);
    const wb = workizOrder(b);
    if (wa !== wb) return wa < wb ? -1 : 1;
    const byCreated = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    return byCreated !== 0 ? byCreated : a.name.localeCompare(b.name);
  });
}

@Injectable()
export class ItemAttributesService {
  private readonly logger = new Logger(ItemAttributesService.name);

  constructor(
    private readonly repository: ItemAttributesRepository,
    private readonly cache: ProductsCacheService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  async list(): Promise<ItemAttribute[]> {
    return sortItemAttributes(await this.repository.listAll());
  }

  async findById(id: string): Promise<ItemAttribute> {
    const attribute = await this.repository.get(id);
    if (!attribute) throw new NotFoundException(`Custom field ${id} not found`);
    return attribute;
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const wanted = name.trim().toLowerCase();
    const all = await this.repository.listAll();
    if (all.some((a) => a.id !== excludeId && a.name.trim().toLowerCase() === wanted)) {
      throw new ConflictException(NAME_IN_USE_MESSAGE);
    }
  }

  async create(dto: CreateItemAttributeDto, caller: { id: string }): Promise<ItemAttribute> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    await this.assertNameAvailable(name);

    const now = new Date().toISOString();
    const attribute: ItemAttribute = {
      id: randomUUID(),
      name,
      type: dto.type ?? 'text',
      visible: dto.visible ?? false,
      resource: ITEM_ATTRIBUTE_RESOURCE,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(attribute);
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-attribute.created', {
      attributeId: attribute.id,
      name,
    });
    return attribute;
  }

  /**
   * Rename, retype or show/hide a definition. A rename first moves the value
   * on every item that has one (`customAttributes[old]` → `[new]`), then
   * stores the new name — so a rename cut short is finished by sending it
   * again: the items already moved no longer match the old name.
   */
  async update(
    id: string,
    dto: UpdateItemAttributeDto,
    _caller: { id: string },
  ): Promise<ItemAttribute & ItemAttributeProductsResult> {
    const existing = await this.findById(id);
    const name = dto.name?.trim();
    const renamed = name !== undefined && name !== existing.name;
    if (renamed) {
      if (!name) throw new BadRequestException('Name is required');
      await this.assertNameAvailable(name, id);
    }

    const result: ItemAttributeProductsResult = { productsUpdated: 0, productsSkipped: 0 };
    if (renamed) {
      await this.forEachProduct(existing.name, result, (row) =>
        this.repository.renameProductValue(row.id, existing.name, name),
      );
    }

    const updated: ItemAttribute = {
      ...existing,
      name: renamed ? name : existing.name,
      type: dto.type ?? existing.type,
      visible: dto.visible ?? existing.visible,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put(updated);
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-attribute.updated', {
      attributeId: id,
      name: updated.name,
      ...(renamed ? { previousName: existing.name } : {}),
    });
    if (renamed) {
      this.logger.log(
        `Renamed custom field "${existing.name}" → "${updated.name}" on ${result.productsUpdated} item(s)` +
          (result.productsSkipped ? `, ${result.productsSkipped} kept as they were` : ''),
      );
    }
    return { ...updated, ...result };
  }

  /**
   * Deletes a definition and its value on every item (Workiz: "Deleting a
   * custom field will remove its associated data"). The values go first, the
   * definition last — a delete cut short is finished by sending it again.
   */
  async remove(id: string, caller: { id: string }): Promise<ItemAttributeProductsResult> {
    const existing = await this.findById(id);
    const result: ItemAttributeProductsResult = { productsUpdated: 0, productsSkipped: 0 };
    await this.forEachProduct(existing.name, result, (row) =>
      this.repository.removeProductValue(row.id, existing.name),
    );
    await this.repository.remove(id);
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-attribute.deleted', {
      attributeId: id,
      name: existing.name,
      deletedBy: caller.id,
    });
    this.logger.log(
      `Deleted custom field "${existing.name}" and its value on ${result.productsUpdated} item(s)`,
    );
    return result;
  }

  /** Runs `write` on every item holding `name`, a few at a time, and counts. */
  private async forEachProduct(
    name: string,
    result: ItemAttributeProductsResult,
    write: (row: ProductAttributeRow) => Promise<boolean>,
  ): Promise<void> {
    await this.repository.forEachProductWithAttribute(name, async (rows) => {
      for (let i = 0; i < rows.length; i += ITEM_ATTRIBUTE_WRITE_CONCURRENCY) {
        await Promise.all(
          rows.slice(i, i + ITEM_ATTRIBUTE_WRITE_CONCURRENCY).map(async (row) => {
            if (!(await write(row))) {
              result.productsSkipped += 1;
              return;
            }
            result.productsUpdated += 1;
            await this.cache.invalidate(row.id);
            publishInventoryEvent(this.snsPublisher, this.logger, 'product.updated', {
              productId: row.id,
            });
          }),
        );
      }
    });
  }
}
