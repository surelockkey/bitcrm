import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventoryLogAction } from '@bitcrm/types';
import { ListInventoryLogQueryDto } from 'src/inventory-log/dto/list-inventory-log-query.dto';

const errorsFor = async (payload: unknown) =>
  (await validate(plainToInstance(ListInventoryLogQueryDto, payload))).map((e) => e.property);

describe('ListInventoryLogQueryDto', () => {
  it('accepts an empty query', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts the full filter set', async () => {
    expect(
      await errorsFor({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-29T12:00:00.000Z',
        productId: 'prod-1',
        userId: 'user-1',
        action: InventoryLogAction.STOCK_USED,
        search: 'deadbolt',
        limit: '50',
        cursor: 'abc',
      }),
    ).toEqual([]);
  });

  it('rejects bounds that are not ISO 8601', async () => {
    expect(await errorsFor({ from: 'yesterday' })).toEqual(['from']);
    expect(await errorsFor({ to: '29/09/2026' })).toEqual(['to']);
  });

  it('rejects an action outside the enum', async () => {
    expect(await errorsFor({ action: 'stock_teleported' })).toEqual(['action']);
  });

  it('reads limit as an integer between 1 and 100, defaulting to 20', async () => {
    expect(plainToInstance(ListInventoryLogQueryDto, { limit: '50' }).limit).toBe(50);
    expect(plainToInstance(ListInventoryLogQueryDto, {}).limit).toBe(20);
    expect(await errorsFor({ limit: '0' })).toEqual(['limit']);
    expect(await errorsFor({ limit: '101' })).toEqual(['limit']);
    expect(await errorsFor({ limit: 'many' })).toEqual(['limit']);
  });
});
