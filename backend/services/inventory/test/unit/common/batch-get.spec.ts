import { ServiceUnavailableException } from '@nestjs/common';
import { batchGetAll } from 'src/common/utils/batch-get';
import { INVENTORY_TABLE } from 'src/common/constants/dynamo.constants';

/**
 * BatchGet приймає 100 ключів за виклик і під тротлінгом повертає частину як
 * UnprocessedKeys (виклик успішний, SDK їх не повторює). Спільний цикл для
 * рядків стоку й товарів: шматки по 100, повтор з паузою, межа спроб.
 */
describe('batchGetAll', () => {
  const keys = (n: number) => Array.from({ length: n }, (_, i) => ({ PK: `PRODUCT#p-${i}`, SK: 'METADATA' }));

  it('asks 100 keys a call and gathers every response', async () => {
    const send = jest.fn(async (command: any) => ({
      Responses: {
        [INVENTORY_TABLE]: command.input.RequestItems[INVENTORY_TABLE].Keys.map((k: any) => ({ ...k, id: k.PK })),
      },
    }));

    const rows = await batchGetAll({ send } as any, keys(230));

    expect(send.mock.calls.map((c: any) => c[0].input.RequestItems[INVENTORY_TABLE].Keys.length)).toEqual([
      100, 100, 30,
    ]);
    expect(rows).toHaveLength(230);
  });

  it('asks again for the keys left unprocessed', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Responses: { [INVENTORY_TABLE]: [{ PK: 'PRODUCT#p-0' }] },
        UnprocessedKeys: { [INVENTORY_TABLE]: { Keys: [{ PK: 'PRODUCT#p-1', SK: 'METADATA' }] } },
      })
      .mockResolvedValueOnce({ Responses: { [INVENTORY_TABLE]: [{ PK: 'PRODUCT#p-1' }] } });

    const rows = await batchGetAll({ send } as any, keys(2));

    expect(rows.map((r: Record<string, unknown>) => r.PK)).toEqual(['PRODUCT#p-0', 'PRODUCT#p-1']);
    expect(send.mock.calls[1][0].input.RequestItems[INVENTORY_TABLE].Keys).toEqual([
      { PK: 'PRODUCT#p-1', SK: 'METADATA' },
    ]);
  });

  it('gives up with a 503 after a bounded number of attempts', async () => {
    const send = jest.fn().mockResolvedValue({
      Responses: { [INVENTORY_TABLE]: [] },
      UnprocessedKeys: { [INVENTORY_TABLE]: { Keys: [{ PK: 'PRODUCT#p-0', SK: 'METADATA' }] } },
    });

    await expect(batchGetAll({ send } as any, keys(1))).rejects.toThrow(ServiceUnavailableException);
    expect(send).toHaveBeenCalledTimes(5);
  });

  /**
   * Найбільша локація — ~1 300 рядків стоку, тобто 13 шматків. Вони йшли
   * один за одним (13 послідовних викликів на попап); тепер — кілька
   * одночасно, з межею, щоб не бити таблицю сплеском.
   */
  it('asks several chunks at once, never more than a few in flight', async () => {
    let inFlight = 0;
    let most = 0;
    const send = jest.fn(async (command: any) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { Responses: { [INVENTORY_TABLE]: command.input.RequestItems[INVENTORY_TABLE].Keys } };
    });

    const rows = await batchGetAll({ send } as any, keys(1300));

    expect(rows).toHaveLength(1300);
    expect(send).toHaveBeenCalledTimes(13);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
  });

  it('keeps retrying one chunk while the others are answered', async () => {
    const send = jest.fn(async (command: any) => {
      const asked = command.input.RequestItems[INVENTORY_TABLE].Keys;
      // The first ask of the first chunk leaves its first key behind.
      if (asked.length === 100 && asked[0].PK === 'PRODUCT#p-0' && send.mock.calls.length === 1) {
        return {
          Responses: { [INVENTORY_TABLE]: asked.slice(1) },
          UnprocessedKeys: { [INVENTORY_TABLE]: { Keys: [asked[0]] } },
        };
      }
      return { Responses: { [INVENTORY_TABLE]: asked } };
    });

    const rows = await batchGetAll({ send } as any, keys(150));

    expect(rows).toHaveLength(150);
    expect(send.mock.calls.map((c: any) => c[0].input.RequestItems[INVENTORY_TABLE].Keys.length).sort()).toEqual([
      1, 100, 50,
    ].sort());
  });

  // Попапу потрібні 7 полів товару, а не 1–2 КБ рядка з описом і атрибутами Workiz.
  it('reads only the attributes asked for, every name escaped', async () => {
    const send = jest.fn().mockResolvedValue({ Responses: { [INVENTORY_TABLE]: [] } });

    await batchGetAll({ send } as any, keys(1), { attributes: ['id', 'name', 'number'] });

    expect(send.mock.calls[0][0].input.RequestItems[INVENTORY_TABLE]).toEqual({
      Keys: [{ PK: 'PRODUCT#p-0', SK: 'METADATA' }],
      ProjectionExpression: '#a0, #a1, #a2',
      ExpressionAttributeNames: { '#a0': 'id', '#a1': 'name', '#a2': 'number' },
    });
  });

  it('reads nothing for no keys', async () => {
    const send = jest.fn();

    expect(await batchGetAll({ send } as any, [])).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
