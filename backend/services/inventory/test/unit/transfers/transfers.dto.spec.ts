import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LocationType, ReturnReason } from '@bitcrm/types';
import { ReceiveStockDto } from 'src/transfers/dto/receive-stock.dto';
import { ReturnStockDto } from 'src/transfers/dto/return-stock.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

const items = [{ productId: 'prod-1', productName: 'Deadbolt', quantity: 2 }];

/** Отримання йде в склад або у фургон — постачальник нічого не зберігає. */
describe('ReceiveStockDto', () => {
  it('accepts a warehouse or a container as the destination', async () => {
    expect(await errorsFor(ReceiveStockDto, { toType: LocationType.WAREHOUSE, toId: 'wh-1', items })).toEqual([]);
    expect(
      await errorsFor(ReceiveStockDto, { toType: LocationType.CONTAINER, toId: 'c-1', items, notes: 'PO 12' }),
    ).toEqual([]);
  });

  it('rejects the supplier as a destination', async () => {
    expect(await errorsFor(ReceiveStockDto, { toType: LocationType.SUPPLIER, toId: 'x', items })).toEqual(['toType']);
  });

  it('requires the destination id and at least a well-formed item list', async () => {
    expect(await errorsFor(ReceiveStockDto, { toType: LocationType.WAREHOUSE, items })).toEqual(['toId']);
    expect(await errorsFor(ReceiveStockDto, { toType: LocationType.WAREHOUSE, toId: 'wh-1' })).toEqual(['items']);
    expect(
      await errorsFor(ReceiveStockDto, {
        toType: LocationType.WAREHOUSE,
        toId: 'wh-1',
        items: [{ productId: 'prod-1', productName: 'Deadbolt', quantity: 0 }],
      }),
    ).toEqual(['items']);
  });
});

/** Повернення забирає товар з локації без роботи, і причина обов'язкова. */
describe('ReturnStockDto', () => {
  it('accepts a return from a container or a warehouse with a reason', async () => {
    expect(
      await errorsFor(ReturnStockDto, { fromType: LocationType.CONTAINER, fromId: 'c-1', items, reason: ReturnReason.DAMAGED }),
    ).toEqual([]);
    expect(
      await errorsFor(ReturnStockDto, {
        fromType: LocationType.WAREHOUSE,
        fromId: 'wh-1',
        items,
        reason: ReturnReason.OTHER,
        notes: 'water damage',
      }),
    ).toEqual([]);
  });

  it('requires a reason from the list', async () => {
    expect(await errorsFor(ReturnStockDto, { fromType: LocationType.CONTAINER, fromId: 'c-1', items })).toEqual(['reason']);
    expect(
      await errorsFor(ReturnStockDto, { fromType: LocationType.CONTAINER, fromId: 'c-1', items, reason: 'gone' }),
    ).toEqual(['reason']);
  });

  it('rejects the supplier as a source', async () => {
    expect(
      await errorsFor(ReturnStockDto, { fromType: LocationType.SUPPLIER, fromId: 'x', items, reason: ReturnReason.LOST }),
    ).toEqual(['fromType']);
  });
});
