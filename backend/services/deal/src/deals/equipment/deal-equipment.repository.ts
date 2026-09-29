import { Injectable } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type DealEquipment } from '@bitcrm/types';
import { DEALS_TABLE, DEAL_EQUIPMENT_SK_PREFIX } from '../../common/constants/dynamo.constants';

/** Equipment rows live alongside the deal: PK=DEAL#<id>, SK=EQUIP#<equipmentId>. */
@Injectable()
export class DealEquipmentRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private key(dealId: string, id: string) {
    return { PK: `DEAL#${dealId}`, SK: `${DEAL_EQUIPMENT_SK_PREFIX}${id}` };
  }

  async create(eq: DealEquipment): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: { ...this.key(eq.dealId, eq.id), ...eq } }),
    );
  }

  async get(dealId: string, id: string): Promise<DealEquipment | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: DEALS_TABLE, Key: this.key(dealId, id) }),
    );
    return result.Item ? toEquipment(result.Item) : null;
  }

  async listByDeal(dealId: string): Promise<DealEquipment[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `DEAL#${dealId}`, ':sk': DEAL_EQUIPMENT_SK_PREFIX },
      }),
    );
    return (result.Items || []).map(toEquipment);
  }

  /** `null` clears a field; `undefined` leaves it as it is. */
  async update(dealId: string, id: string, patch: Record<string, string | null | undefined>): Promise<DealEquipment> {
    const sets: string[] = [];
    const removes: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      names[`#${k}`] = k;
      if (v === null) {
        removes.push(`#${k}`);
      } else {
        sets.push(`#${k} = :${k}`);
        values[`:${k}`] = v;
      }
    }
    const expression = [sets.length ? `SET ${sets.join(', ')}` : '', removes.length ? `REMOVE ${removes.join(', ')}` : '']
      .filter(Boolean)
      .join(' ');
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: DEALS_TABLE,
        Key: this.key(dealId, id),
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toEquipment(result.Attributes || {});
  }

  async delete(dealId: string, id: string): Promise<void> {
    await this.dynamoDb.client.send(new DeleteCommand({ TableName: DEALS_TABLE, Key: this.key(dealId, id) }));
  }
}

const OPTIONAL = [
  'brand',
  'laborWarrantyUntil',
  'manufacturerWarrantyUntil',
  'serial',
  'installedOn',
  'propertyAddress',
  'locationInProperty',
  'notes',
] as const;

/** Read whitelist: the row's keys (PK/SK) never reach a caller. */
function toEquipment(item: Record<string, unknown>): DealEquipment {
  const eq: DealEquipment = {
    id: item.id as string,
    dealId: item.dealId as string,
    contactId: item.contactId as string,
    name: item.name as string,
    model: item.model as string,
    createdBy: item.createdBy as string,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };
  for (const k of OPTIONAL) if (typeof item[k] === 'string') eq[k] = item[k] as string;
  return eq;
}
