import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { type ItemGroup, type ItemGroupStatus, type Product } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import { ProductsRepository } from '../products/products.repository';
import { ItemCategoriesRepository } from '../item-categories/item-categories.repository';
import { ItemGroupsRepository, type ItemGroupChanges, type StoredItemGroupMember } from './item-groups.repository';
import { type CreateItemGroupDto } from './dto/create-item-group.dto';
import { type UpdateItemGroupDto } from './dto/update-item-group.dto';
import { type ItemGroupMemberDto } from './dto/item-group-member.dto';

/** Workiz's words for a name already taken (as on the custom fields). */
export const ITEM_GROUP_NAME_IN_USE = 'Name is in use, please pick a different one';

/** What the caller may do with money: set a member's cost (`financials.view`). */
export interface ItemGroupCaller {
  canSeeCost: boolean;
}

/** The fields a member is built from; everything else on a stored member is the importer's. */
const MEMBER_FIELDS = new Set([
  'productId', 'name', 'quantity', 'priceClient', 'taxable', 'description', 'customAttributes', 'cost',
]);

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Text values only, blanks dropped — what a line's custom fields hold. */
function textValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  return out;
}

const byName = (a: ItemGroup, b: ItemGroup) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

/**
 * Item groups — Workiz's "Item groups" tab of the Price book: named sets of
 * price-book items a job (or an estimate) takes in one go. Listed by name
 * under Workiz's status box; made and edited here (Individual items groups);
 * disabled, never deleted — a job line keeps naming its group.
 */
@Injectable()
export class ItemGroupsService {
  private readonly logger = new Logger(ItemGroupsService.name);

  constructor(
    private readonly repository: ItemGroupsRepository,
    private readonly products: ProductsRepository,
    private readonly categories: ItemCategoriesRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  /** The groups by name (case-insensitive) — the order Workiz's picker shows — under the status box. */
  async list(status: ItemGroupStatus = 'all'): Promise<ItemGroup[]> {
    const groups = await this.repository.listAll();
    return groups
      .filter((g) => status === 'all' || g.active === (status === 'active'))
      .sort(byName);
  }

  async findById(id: string): Promise<ItemGroup> {
    const group = await this.repository.get(id);
    if (!group) throw new NotFoundException(`Item group ${id} not found`);
    return group;
  }

  async create(dto: CreateItemGroupDto, caller: { id: string }, who: ItemGroupCaller): Promise<ItemGroup> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    await this.assertNameAvailable(name);
    const categoryId = await this.category(dto.categoryId);
    const members = await this.buildMembers(dto.members, [], who);

    const now = new Date().toISOString();
    const id = randomUUID();
    await this.repository.create({
      id,
      name,
      description: (dto.description ?? '').trim(),
      groupType: 'separate_items',
      ...(categoryId && { categoryId }),
      active: dto.active ?? true,
      members,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    });
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-group.created', { itemGroupId: id, name });
    return this.findById(id);
  }

  /**
   * Only what is sent changes. Members sent back keep, item by item (a
   * repeated item in order), the name, description, custom field values,
   * cost and Workiz extras they had, unless the body changes them.
   */
  async update(
    id: string,
    dto: UpdateItemGroupDto,
    caller: { id: string },
    who: ItemGroupCaller,
  ): Promise<ItemGroup> {
    const row = await this.repository.getRow(id);
    if (!row) throw new NotFoundException(`Item group ${id} not found`);

    const changes: ItemGroupChanges = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      await this.assertNameAvailable(name, id);
      changes.name = name;
    }
    if (dto.description !== undefined) changes.description = dto.description.trim();
    if (dto.categoryId !== undefined) changes.categoryId = (await this.category(dto.categoryId)) ?? null;
    if (dto.active !== undefined) changes.active = dto.active;
    if (dto.members !== undefined) {
      const previous = Array.isArray(row.members) ? (row.members as Record<string, unknown>[]) : [];
      changes.members = await this.buildMembers(dto.members, previous, who);
    }

    const group = await this.repository.update(id, changes, {
      updatedAt: new Date().toISOString(),
      updatedBy: caller.id,
    });
    publishInventoryEvent(this.snsPublisher, this.logger, 'item-group.updated', {
      itemGroupId: id,
      name: group.name,
      active: group.active,
    });
    return group;
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const wanted = name.trim().toLowerCase();
    const all = await this.repository.listAll();
    if (all.some((g) => g.id !== excludeId && g.name.trim().toLowerCase() === wanted)) {
      throw new ConflictException(ITEM_GROUP_NAME_IN_USE);
    }
  }

  /** "" / null ⇒ none; else a category that exists. */
  private async category(value: string | null | undefined): Promise<string | undefined> {
    const id = value?.trim();
    if (!id) return undefined;
    if (!(await this.categories.get(id))) throw new BadRequestException(`Category ${id} not found`);
    return id;
  }

  /**
   * The stored members. Every item must be in the price book. A member
   * matched to one the group already had (same item, in order) keeps its
   * name, description, taxable flag, custom field values, cost and the
   * importer's extras unless the body sets them; a new one takes the item's.
   * A cost is taken from the body only from a caller who may see money.
   */
  private async buildMembers(
    input: ItemGroupMemberDto[],
    previous: Record<string, unknown>[],
    who: ItemGroupCaller,
  ): Promise<StoredItemGroupMember[]> {
    if (input.length === 0) throw new BadRequestException('Add at least one item');
    const found = await this.products.findByIds(input.map((m) => m.productId));
    const catalog = new Map<string, Product>(found.map((p) => [p.id, p]));
    const missing = input.find((m) => !catalog.has(m.productId));
    if (missing) throw new BadRequestException(`Item ${missing.productId} is not in the price book`);

    const unused = [...previous];
    const take = (productId: string): Record<string, unknown> | undefined => {
      const at = unused.findIndex((m) => m && m.productId === productId);
      return at < 0 ? undefined : unused.splice(at, 1)[0];
    };

    return input.map((m) => {
      const product = catalog.get(m.productId)!;
      const before = take(m.productId);
      const extras = Object.fromEntries(Object.entries(before ?? {}).filter(([k]) => !MEMBER_FIELDS.has(k)));
      const name = m.name?.trim() || (typeof before?.name === 'string' && before.name) || product.name;
      const description =
        m.description !== undefined ? m.description.trim() : typeof before?.description === 'string' ? before.description : '';
      const taxable =
        m.taxable ?? (typeof before?.taxable === 'boolean' ? before.taxable : product.taxable !== false);
      const customAttributes = textValues(m.customAttributes ?? before?.customAttributes);
      const cost =
        who.canSeeCost && m.cost !== undefined ? m.cost : finiteOr(before?.cost, finiteOr(product.costCompany, 0));
      return {
        productId: m.productId,
        name,
        quantity: m.quantity,
        priceClient: m.priceClient,
        taxable,
        description,
        customAttributes,
        cost,
        ...extras,
      };
    });
  }
}
