import { TransfersRepository } from 'src/transfers/transfers.repository';
import { createMockTransfer, createMockDynamoDbService } from '../mocks';

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
  });
});
