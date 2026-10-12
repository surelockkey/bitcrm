import { Injectable, Logger } from '@nestjs/common';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { ITEM_GROUP_TYPES, type ItemGroup, type ItemGroupMember, type ItemGroupType } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME } from '../common/constants/dynamo.constants';
import { ITEM_GROUP_GSI1PK, ITEM_GROUP_PK_PREFIX, ITEM_GROUP_SK } from './item-groups.constants';

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Only text values — the shape `Product.customAttributes` has. */
function textValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  return out;
}

/**
 * A member as the table keeps it: the fields a job line takes, the group's own
 * cost, and whatever the Workiz import put beside them (`workizItemId`,
 * `groupMemberId`, `nonDiscountable`, `manageStock`), which a BitCRM edit
 * carries through.
 */
export interface StoredItemGroupMember {
  productId: string;
  name: string;
  quantity: number;
  priceClient: number;
  taxable: boolean;
  description: string;
  customAttributes: Record<string, string>;
  cost: number;
  [extra: string]: unknown;
}

/** A new group's row, keys aside. */
export interface NewItemGroupRow {
  id: string;
  name: string;
  description: string;
  groupType: ItemGroupType;
  categoryId?: string;
  active: boolean;
  members: StoredItemGroupMember[] | Record<string, unknown>[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** What an edit may change. `categoryId: null` takes the group out of its category. */
export interface ItemGroupChanges {
  name?: string;
  description?: string;
  categoryId?: string | null;
  active?: boolean;
  members?: StoredItemGroupMember[] | Record<string, unknown>[];
}

/**
 * A stored member as the API serves it — the fields a job line takes and the
 * group's own cost (the controller drops it for a caller without
 * `financials.view`); the importer's other extras stay in the table. A member
 * whose Workiz item has no product here (`productId` empty) is left out — it
 * could never become a job line.
 */
function toMember(row: unknown): ItemGroupMember | null {
  if (!row || typeof row !== 'object') return null;
  const m = row as Record<string, unknown>;
  if (typeof m.productId !== 'string' || !m.productId) return null;
  return {
    productId: m.productId,
    name: str(m.name),
    quantity: finite(m.quantity),
    priceClient: finite(m.priceClient),
    // Absent ⇒ taxable, as on a price-book product.
    taxable: m.taxable !== false,
    description: str(m.description),
    customAttributes: textValues(m.customAttributes),
    ...(typeof m.cost === 'number' && Number.isFinite(m.cost) && { cost: m.cost }),
  };
}

/** Σ quantity × priceClient, in cents so 3 × $0.10 is $0.30. */
export function itemGroupTotal(members: Pick<ItemGroupMember, 'quantity' | 'priceClient'>[]): number {
  const cents = members.reduce((sum, m) => sum + m.quantity * m.priceClient * 100, 0);
  return Math.round(cents) / 100;
}

/** Workiz's two types; a row that names none (or another) is Individual items. */
function groupTypeOf(value: unknown): ItemGroupType {
  return (ITEM_GROUP_TYPES as readonly string[]).includes(value as string) ? (value as ItemGroupType) : 'separate_items';
}

/**
 * BitCRM's `active` when it has written one; else the import's `isEnabled`
 * (Workiz's flag); else on.
 */
function activeOf(row: Record<string, unknown>): boolean {
  if (typeof row.active === 'boolean') return row.active;
  return row.isEnabled !== false;
}

/**
 * Item groups (`ITEM_GROUP#<id>` / `METADATA`, members inline), the rows the
 * Workiz import writes and the Price book's Item groups tab makes and edits.
 * An edit is an UpdateCommand of the fields it changes, so the importer's
 * attributes (`resource`, `externalId`, `workizFilePath`…) survive it.
 */
@Injectable()
export class ItemGroupsRepository {
  private readonly logger = new Logger(ItemGroupsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private key(id: string) {
    return { PK: `${ITEM_GROUP_PK_PREFIX}${id}`, SK: ITEM_GROUP_SK };
  }

  async get(id: string): Promise<ItemGroup | null> {
    const row = await this.getRow(id);
    return row ? this.toEntity(row) : null;
  }

  /** The stored row as it is — the members with the importer's extras. */
  async getRow(id: string): Promise<Record<string, unknown> | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: INVENTORY_TABLE, Key: this.key(id) }),
    );
    return (result.Item as Record<string, unknown> | undefined) ?? null;
  }

  /** Every group — a Query of the catalog partition to its end, never a Scan. */
  async listAll(): Promise<ItemGroup[]> {
    const rows: Record<string, unknown>[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': ITEM_GROUP_GSI1PK },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      rows.push(...(result.Items ?? []));
      key = result.LastEvaluatedKey;
    } while (key);
    return rows.map((row) => this.toEntity(row));
  }

  /** A new group; refused if the id is already there. */
  async create(group: NewItemGroupRow): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          ...this.key(group.id),
          GSI1PK: ITEM_GROUP_GSI1PK,
          GSI1SK: group.name.toLowerCase(),
          ...group,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created item group ${group.id} (${group.name})`);
  }

  /**
   * SETs what changed (the sort key moves with the name), REMOVEs a cleared
   * category and Workiz's `itemNames` once the members change; answers the
   * group as it now is. Refused for a group that is not there.
   */
  async update(
    id: string,
    changes: ItemGroupChanges,
    meta: { updatedAt: string; updatedBy: string },
  ): Promise<ItemGroup> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    const removes: string[] = [];
    const set = (attr: string, value: unknown) => {
      names[`#${attr}`] = attr;
      values[`:${attr}`] = value;
      sets.push(`#${attr} = :${attr}`);
    };
    const remove = (attr: string) => {
      names[`#${attr}`] = attr;
      removes.push(`#${attr}`);
    };

    if (changes.name !== undefined) {
      set('name', changes.name);
      set('GSI1SK', changes.name.toLowerCase());
    }
    if (changes.description !== undefined) set('description', changes.description);
    if (changes.categoryId === null) remove('categoryId');
    else if (changes.categoryId !== undefined) set('categoryId', changes.categoryId);
    if (changes.active !== undefined) set('active', changes.active);
    if (changes.members !== undefined) {
      set('members', changes.members);
      remove('itemNames');
    }
    set('updatedAt', meta.updatedAt);
    set('updatedBy', meta.updatedBy);

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: this.key(id),
        UpdateExpression: `SET ${sets.join(', ')}${removes.length ? ` REMOVE ${removes.join(', ')}` : ''}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return this.toEntity((result.Attributes ?? {}) as Record<string, unknown>);
  }

  private toEntity(row: Record<string, unknown>): ItemGroup {
    const members = (Array.isArray(row.members) ? row.members : [])
      .map(toMember)
      .filter((m): m is ItemGroupMember => m !== null);
    return {
      id: row.id as string,
      name: str(row.name),
      description: str(row.description),
      groupType: groupTypeOf(row.groupType),
      ...(typeof row.categoryId === 'string' && row.categoryId && { categoryId: row.categoryId }),
      active: activeOf(row),
      members,
      total: itemGroupTotal(members),
      ...(typeof row.externalId === 'string' && { externalId: row.externalId }),
      ...(typeof row.createdBy === 'string' && { createdBy: row.createdBy }),
      ...(typeof row.createdAt === 'string' && { createdAt: row.createdAt }),
      ...(typeof row.updatedAt === 'string' && { updatedAt: row.updatedAt }),
    };
  }
}
