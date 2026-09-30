import { BadRequestException } from '@nestjs/common';
import { ReturnReason, TransferType } from '@bitcrm/types';
import { TransfersRepository } from 'src/transfers/transfers.repository';
import { createMockTransfer, createMockDynamoDbService } from '../mocks';

/** Рядок руху несе роботу (deduct/restore) і причину (return) — і віддає їх назад. */
describe('TransfersRepository.findById', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: TransfersRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new TransfersRepository(dynamoDb as any);
  });

  it('reads dealId and reason back off the row', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: {
        ...createMockTransfer({ type: TransferType.RETURN, toType: null, toId: null }),
        dealId: 'deal-1',
        reason: ReturnReason.DAMAGED,
        PK: 'TRANSFER#transfer-1',
        SK: 'METADATA',
      },
    });

    const transfer = await repository.findById('transfer-1');

    expect(transfer).toMatchObject({ dealId: 'deal-1', reason: ReturnReason.DAMAGED });
  });

  it('leaves them off a row that has none', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: { ...createMockTransfer(), PK: 'TRANSFER#transfer-1', SK: 'METADATA' },
    });

    const transfer = await repository.findById('transfer-1');

    expect(transfer?.dealId).toBeUndefined();
    expect(transfer?.reason).toBeUndefined();
  });
});

/**
 * Рухи товару більше не Scan спільної таблиці (~46 тис. рядків, з яких рухів —
 * жменька): Scan+Limit відфільтровував після ліміту і віддавав порожні
 * сторінки з курсором, у хеш-порядку, а лічильник читав до 20 МБ. Тепер
 * кожен рядок руху лежить на розділі свого місяця на GSI1
 * (`TRANSFERS#<YYYY-MM>` / `<createdAt>#<id>`), список іде від поточного
 * місяця назад до найпершого (рядок `TRANSFERS#INDEX`), найновіші першими.
 */
describe('TransfersRepository — month index', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: TransfersRepository;

  type Row = Record<string, unknown> & { id: string; type: string; createdAt: string };
  const row = (id: string, createdAt: string, type = TransferType.TRANSFER): Row => ({
    ...createMockTransfer({ id, type, createdAt }),
    PK: `TRANSFER#${id}`,
    SK: 'METADATA',
    GSI1PK: `TRANSFERS#${createdAt.slice(0, 7)}`,
    GSI1SK: `${createdAt}#${id}`,
  });
  const keyOf = (r: Row) => ({ PK: r.PK, SK: r.SK, GSI1PK: r.GSI1PK, GSI1SK: r.GSI1SK });
  const decode = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString());
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  /** A table of transfers by month, answered the way DynamoDB would (newest first, Limit counts rows read). */
  function table(rows: Row[], firstMonth?: string) {
    dynamoDb.client.send.mockImplementation(async (command: any) => {
      const name = command.constructor.name;
      const input = command.input;
      if (name === 'GetCommand') {
        return firstMonth ? { Item: { PK: 'TRANSFERS#INDEX', SK: 'METADATA', firstMonth } } : {};
      }
      if (name === 'QueryCommand') {
        const month = String(input.ExpressionAttributeValues[':pk']);
        const partition = rows
          .filter((r) => r.GSI1PK === month)
          .sort((a, b) => String(b.GSI1SK).localeCompare(String(a.GSI1SK)));
        const start = input.ExclusiveStartKey
          ? partition.findIndex((r) => r.GSI1SK === input.ExclusiveStartKey.GSI1SK) + 1
          : 0;
        const read = partition.slice(start, input.Limit ? start + input.Limit : undefined);
        const type = input.ExpressionAttributeValues[':type'];
        const kept = type ? read.filter((r) => r.type === type) : read;
        const more = start + read.length < partition.length;
        const lastKey = more ? keyOf(read[read.length - 1]) : undefined;
        if (input.Select === 'COUNT') return { Count: kept.length, LastEvaluatedKey: lastKey };
        return { Items: kept, LastEvaluatedKey: lastKey };
      }
      return {};
    });
  }

  const queries = () =>
    dynamoDb.client.send.mock.calls.map((c) => c[0]).filter((c: any) => c.constructor.name === 'QueryCommand');

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new TransfersRepository(dynamoDb as any);
    jest.spyOn(repository as any, 'currentMonth').mockReturnValue('2026-09');
  });

  describe('create', () => {
    beforeEach(() => dynamoDb.client.send.mockResolvedValue({}));

    it('files the transfer row on its month partition, by time', async () => {
      await repository.create(createMockTransfer({ id: 't-1', createdAt: '2026-09-14T08:00:00.000Z' }));

      const put = dynamoDb.client.send.mock.calls
        .map((c) => c[0])
        .find((c: any) => c.constructor.name === 'PutCommand' && c.input.Item.SK === 'METADATA');
      expect(put.input.Item).toMatchObject({
        PK: 'TRANSFER#t-1',
        GSI1PK: 'TRANSFERS#2026-09',
        GSI1SK: '2026-09-14T08:00:00.000Z#t-1',
      });
    });

    // Нижня межа прогулянки по місяцях: перший місяць, у якому є рух.
    it('moves the first month down to this one when it is earlier or unset, never up', async () => {
      await repository.create(createMockTransfer({ id: 't-1', createdAt: '2026-09-14T08:00:00.000Z' }));

      const floor = dynamoDb.client.send.mock.calls
        .map((c) => c[0])
        .find((c: any) => c.constructor.name === 'UpdateCommand');
      expect(floor.input).toMatchObject({
        Key: { PK: 'TRANSFERS#INDEX', SK: 'METADATA' },
        UpdateExpression: 'SET firstMonth = :month',
        ConditionExpression: 'attribute_not_exists(firstMonth) OR firstMonth > :month',
        ExpressionAttributeValues: { ':month': '2026-09' },
      });
    });

    it('is not an error when the first month is already earlier', async () => {
      const refused = Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' });
      dynamoDb.client.send.mockImplementation(async (command: any) => {
        if (command.constructor.name === 'UpdateCommand') throw refused;
        return {};
      });

      await expect(repository.create(createMockTransfer())).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('queries the current month on GSI1, newest first — never a Scan', async () => {
      table([row('t1', '2026-09-02T10:00:00.000Z')], '2026-09');

      const page = await repository.findAll(20);

      const [query] = queries();
      expect(query.input).toMatchObject({
        IndexName: 'CategoryIndex',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'TRANSFERS#2026-09' },
        ScanIndexForward: false,
      });
      expect(query.input.FilterExpression).toBeUndefined();
      expect(dynamoDb.client.send.mock.calls.some((c) => c[0].constructor.name === 'ScanCommand')).toBe(false);
      expect(page.items.map((t) => t.id)).toEqual(['t1']);
      expect(page.nextCursor).toBeUndefined();
    });

    it('walks back month by month to fill the page, newest first, and stops at the first month', async () => {
      table(
        [
          row('sep', '2026-09-01T00:00:00.000Z'),
          row('jul-b', '2026-07-20T00:00:00.000Z'),
          row('jul-a', '2026-07-03T00:00:00.000Z'),
        ],
        '2026-07',
      );

      const page = await repository.findAll(20);

      expect(page.items.map((t) => t.id)).toEqual(['sep', 'jul-b', 'jul-a']);
      expect(queries().map((q: any) => q.input.ExpressionAttributeValues[':pk'])).toEqual([
        'TRANSFERS#2026-09',
        'TRANSFERS#2026-08',
        'TRANSFERS#2026-07',
      ]);
      expect(page.nextCursor).toBeUndefined();
    });

    it('answers nothing, without a month read, when no transfer was ever filed', async () => {
      table([]);

      expect(await repository.findAll(20)).toEqual({ items: [], nextCursor: undefined });
      expect(queries()).toHaveLength(0);
    });

    it('hands back where it stopped inside a month and resumes there', async () => {
      const rows = [
        row('a', '2026-09-03T00:00:00.000Z'),
        row('b', '2026-09-02T00:00:00.000Z'),
        row('c', '2026-09-01T00:00:00.000Z'),
      ];
      table(rows, '2026-09');

      const first = await repository.findAll(2);
      expect(first.items.map((t) => t.id)).toEqual(['a', 'b']);
      expect(decode(first.nextCursor!)).toEqual({ month: '2026-09', lastKey: keyOf(rows[1]) });

      const second = await repository.findAll(2, first.nextCursor);
      expect(second.items.map((t) => t.id)).toEqual(['c']);
      expect(second.nextCursor).toBeUndefined();
    });

    it('points the next page at the next month when a month ends on the page boundary', async () => {
      table([row('a', '2026-09-03T00:00:00.000Z'), row('z', '2026-08-03T00:00:00.000Z')], '2026-08');

      const first = await repository.findAll(1);
      expect(first.items.map((t) => t.id)).toEqual(['a']);

      const second = await repository.findAll(1, first.nextCursor);
      expect(second.items.map((t) => t.id)).toEqual(['z']);
    });

    // Чіпи Receive/Transfer/…: фільтр типу — у FilterExpression місячного
    // Query, сторінка дочитується через місяці, а не приходить порожньою.
    it('filters by type on the server and fills the page across months', async () => {
      table(
        [
          row('r-sep', '2026-09-05T00:00:00.000Z', TransferType.RECEIVE),
          row('t-sep', '2026-09-04T00:00:00.000Z', TransferType.TRANSFER),
          row('r-aug', '2026-08-05T00:00:00.000Z', TransferType.RECEIVE),
        ],
        '2026-08',
      );

      const page = await repository.findAll(5, undefined, { type: TransferType.RECEIVE });

      const [query] = queries();
      expect(query.input.FilterExpression).toBe('#type = :type');
      expect(query.input.ExpressionAttributeNames).toEqual({ '#type': 'type' });
      expect(page.items.map((t) => t.id)).toEqual(['r-sep', 'r-aug']);
      expect(page.items).toHaveLength(2);
    });

    it('never answers more than the limit', async () => {
      table(
        Array.from({ length: 7 }, (_, i) => row(`t${i}`, `2026-09-0${i + 1}T00:00:00.000Z`)),
        '2026-09',
      );

      expect((await repository.findAll(5)).items).toHaveLength(5);
    });

    // Курсор зі Scan-версії ({ PK, SK }) з вкладки, відкритої через деплой.
    it('rejects a cursor that is not one of its own with a 400, before any read', async () => {
      await expect(repository.findAll(20, encode({ PK: 'TRANSFER#t1', SK: 'METADATA' }))).rejects.toThrow(
        BadRequestException,
      );
      await expect(repository.findAll(20, 'not-json!')).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });
  });

  describe('countAll', () => {
    it('counts every month from the first to the current one, without bodies, and adds them up', async () => {
      table(
        [
          row('a', '2026-09-03T00:00:00.000Z'),
          row('b', '2026-07-02T00:00:00.000Z'),
          row('c', '2026-07-01T00:00:00.000Z'),
        ],
        '2026-07',
      );

      expect(await repository.countAll()).toEqual({ total: 3, atLeast: false });
      const counted = queries();
      expect(counted.every((q: any) => q.input.Select === 'COUNT')).toBe(true);
      expect(counted.map((q: any) => q.input.ExpressionAttributeValues[':pk']).sort()).toEqual([
        'TRANSFERS#2026-07',
        'TRANSFERS#2026-08',
        'TRANSFERS#2026-09',
      ]);
    });

    it('counts under the same type filter the list applies', async () => {
      table(
        [row('r', '2026-09-03T00:00:00.000Z', TransferType.RETURN), row('t', '2026-09-02T00:00:00.000Z')],
        '2026-09',
      );

      expect(await repository.countAll({ type: TransferType.RETURN })).toEqual({ total: 1, atLeast: false });
      expect(queries()[0].input.FilterExpression).toBe('#type = :type');
    });

    it('is zero, without a month read, when no transfer was ever filed', async () => {
      table([]);

      expect(await repository.countAll()).toEqual({ total: 0, atLeast: false });
      expect(queries()).toHaveLength(0);
    });
  });
});

/**
 * Рухи однієї локації (GSI4): рядок-посилання на рух, у який товар прийшов,
 * читався окремим GetItem на кожен — N послідовних запитів на сторінку.
 */
describe('TransfersRepository.findByEntity', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: TransfersRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new TransfersRepository(dynamoDb as any);
  });

  it('reads the transfers the reference rows point at in one batch, keeping the index order', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({
        Items: [
          { PK: 'TRANSFER#t3', SK: 'ENTITY_REF#container#c-1', transferId: 't3' },
          { ...createMockTransfer({ id: 't2' }), PK: 'TRANSFER#t2', SK: 'METADATA' },
          { PK: 'TRANSFER#t1', SK: 'ENTITY_REF#container#c-1', transferId: 't1' },
        ],
      })
      .mockResolvedValueOnce({
        Responses: {
          BitCRM_Inventory: [
            { ...createMockTransfer({ id: 't1' }), PK: 'TRANSFER#t1', SK: 'METADATA' },
            { ...createMockTransfer({ id: 't3' }), PK: 'TRANSFER#t3', SK: 'METADATA' },
          ],
        },
      });

    const page = await repository.findByEntity('container', 'c-1', 20);

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    const batch = dynamoDb.client.send.mock.calls[1][0];
    expect(batch.constructor.name).toBe('BatchGetCommand');
    expect(batch.input.RequestItems.BitCRM_Inventory.Keys).toEqual([
      { PK: 'TRANSFER#t3', SK: 'METADATA' },
      { PK: 'TRANSFER#t1', SK: 'METADATA' },
    ]);
    expect(page.items.map((t) => t.id)).toEqual(['t3', 't2', 't1']);
  });

  it('reads nothing more when the page holds only transfer rows', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({
      Items: [{ ...createMockTransfer({ id: 't2' }), PK: 'TRANSFER#t2', SK: 'METADATA' }],
    });

    await repository.findByEntity('warehouse', 'wh-1', 20);

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
  });

  it('rejects a cursor that is not base64url JSON with a 400, not a 500', async () => {
    await expect(repository.findByEntity('warehouse', 'wh-1', 20, '%%%')).rejects.toThrow(BadRequestException);
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });
});
