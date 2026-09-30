import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LocationType, ReturnReason } from '@bitcrm/types';
import { ReceiveStockDto } from 'src/transfers/dto/receive-stock.dto';
import { ReturnStockDto } from 'src/transfers/dto/return-stock.dto';
import { CreateTransferDto } from 'src/transfers/dto/create-transfer.dto';
import { ReceiveWarehouseStockDto } from 'src/warehouses/dto/receive-stock.dto';

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

/**
 * Одиниці — цілі. 1.5 проходило `@IsNumber @Min(1)`, лягало на рядок стоку
 * й у onHand, а наступне списання двох падало "Insufficient stock" при 1.5 у попапі.
 */
describe('movement quantities are whole numbers', () => {
  const fractional = [{ productId: 'prod-1', productName: 'Deadbolt', quantity: 1.5 }];

  it('on a receive', async () => {
    expect(await errorsFor(ReceiveStockDto, { toType: LocationType.WAREHOUSE, toId: 'wh-1', items: fractional })).toEqual(['items']);
  });

  it('on a return', async () => {
    expect(
      await errorsFor(ReturnStockDto, { fromType: LocationType.CONTAINER, fromId: 'c-1', items: fractional, reason: ReturnReason.LOST }),
    ).toEqual(['items']);
  });

  it('on a transfer', async () => {
    const base = { fromType: LocationType.WAREHOUSE, fromId: 'wh-1', toType: LocationType.CONTAINER, toId: 'c-1' };
    expect(await errorsFor(CreateTransferDto, { ...base, items: fractional })).toEqual(['items']);
    expect(await errorsFor(CreateTransferDto, { ...base, items })).toEqual([]);
  });

  it('on a warehouse receive', async () => {
    expect(await errorsFor(ReceiveWarehouseStockDto, { items: fractional })).toEqual(['items']);
    expect(await errorsFor(ReceiveWarehouseStockDto, { items })).toEqual([]);
  });
});
