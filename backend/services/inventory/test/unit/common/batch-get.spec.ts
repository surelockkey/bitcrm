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

  it('reads nothing for no keys', async () => {
    const send = jest.fn();

    expect(await batchGetAll({ send } as any, [])).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});
