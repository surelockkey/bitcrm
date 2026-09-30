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
 * Рух товару лежить у спільній таблиці інвентарю поруч із товарами, SKU,
 * залишками, фургонами й складами. Фільтрований Scan читає здебільшого чуже, а
 * `Limit` рахує прочитане, не знайдене — тож сторінка приходила короткою, хоч
 * рухів вистачало.
 */
describe('TransfersRepository.findAll', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: TransfersRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new TransfersRepository(dynamoDb as any);
  });

  const row = (id: string) => ({
    ...createMockTransfer(),
    id,
    PK: `TRANSFER#${id}`,
    SK: 'METADATA',
  });

  it('fills the page across reads', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [row('t1')], LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' } })
      .mockResolvedValueOnce({ Items: [row('t2')], LastEvaluatedKey: undefined });

    const result = await repository.findAll(3);

    expect(result.items.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.nextCursor).toBeUndefined();
  });

  it('stops once the page is full, resuming at the last row kept', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({
      Items: [row('t1'), row('t2'), row('t3')],
      LastEvaluatedKey: { PK: 'X#9', SK: 'METADATA' },
    });

    const result = await repository.findAll(2);

    expect(result.items.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(JSON.parse(Buffer.from(result.nextCursor!, 'base64').toString())).toEqual({
      PK: 'TRANSFER#t2',
      SK: 'METADATA',
    });
  });

  // Фільтр типу — у FilterExpression того самого Scan: сторінка дочитується,
  // а не фільтрується в браузері, як робили чіпи на вебі.
  it('filters by type inside the Scan, so the page still fills', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [row('t1')] });

    await repository.findAll(20, undefined, { type: TransferType.RECEIVE });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toBe('begins_with(PK, :pk) AND SK = :sk AND #type = :type');
    expect(input.ExpressionAttributeNames).toEqual({ '#type': 'type' });
    expect(input.ExpressionAttributeValues).toEqual({
      ':pk': 'TRANSFER#',
      ':sk': 'METADATA',
      ':type': TransferType.RECEIVE,
    });
  });

  it('leaves the Scan bare without a type', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.findAll(20);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toBe('begins_with(PK, :pk) AND SK = :sk');
    expect(input.ExpressionAttributeNames).toBeUndefined();
  });

  /**
   * Скільки всього трансферів — число для «Page 2 of 7». Той самий Scan, що
   * й у списку, але без тіл рядків і з обмеженим проходом: таблиця інвентарю
   * спільна, і більшість прочитаного — не трансфери.
   */
  describe('countAll', () => {
    it('counts without pulling item bodies back', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 18 });

      expect(await repository.countAll()).toEqual({ total: 18, atLeast: false });
      expect(dynamoDb.client.send.mock.calls[0][0].input.Select).toBe('COUNT');
    });

    it('sums across the walk', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Count: 10, LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Count: 8 });

      expect(await repository.countAll()).toEqual({ total: 18, atLeast: false });
    });

    it('gives up on an exact answer rather than walk the whole table', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Count: 1,
        LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' },
      });

      expect((await repository.countAll()).atLeast).toBe(true);
    });

    it('counts under the same type filter the list applies', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 4 });

      await repository.countAll({ type: TransferType.RETURN });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toBe('begins_with(PK, :pk) AND SK = :sk AND #type = :type');
      expect(input.ExpressionAttributeValues[':type']).toBe(TransferType.RETURN);
    });
  });
});
