import {
  PRODUCT_STOCK_INDEX_PK,
  expectedStockIndexKeys,
  stockIndexChange,
  stockIndexWriteCondition,
  stockIndexWrite,
} from 'src/products/product-stock-index';

/**
 * "Inventory products" (manageStock=true) без категорії були фільтрованим Scan
 * по всій спільній таблиці (46 102 рядки), і бюджет читань scanPage покривав
 * ~10 тис.: перша сторінка приходила порожньою з курсором. Складські товари
 * отримують власну розріджену партицію на GSI3, у порядку назви.
 */
describe('expectedStockIndexKeys', () => {
  const row = { PK: 'PRODUCT#p-1', SK: 'METADATA', id: 'p-1', name: ' Kwikset Deadbolt ', type: 'product' };

  it('keys a product whose stock is managed (flag absent or true), whatever its status', () => {
    const keys = { GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'kwikset deadbolt#p-1' };
    expect(PRODUCT_STOCK_INDEX_PK).toBe('PRODUCTS#STOCK');
    expect(expectedStockIndexKeys(row)).toEqual(keys);
    expect(expectedStockIndexKeys({ ...row, manageStock: true })).toEqual(keys);
    expect(expectedStockIndexKeys({ ...row, status: 'archived' })).toEqual(keys);
    // A flag cleared to null counts as absent: managed.
    expect(expectedStockIndexKeys({ ...row, manageStock: null })).toEqual(keys);
  });

  it('keys nothing that is not stock-managed', () => {
    expect(expectedStockIndexKeys({ ...row, manageStock: false })).toBeNull();
    expect(expectedStockIndexKeys({ ...row, type: 'service' })).toBeNull();
    expect(expectedStockIndexKeys({ ...row, type: undefined })).toBeNull();
    expect(expectedStockIndexKeys({ PK: 'CONTAINER#c-1', SK: 'METADATA', type: 'product' })).toBeNull();
    expect(expectedStockIndexKeys({ PK: 'PRODUCT#p-1', SK: 'STOCK#x', type: 'product' })).toBeNull();
  });

  it('takes the id from the PK when the row has none', () => {
    expect(expectedStockIndexKeys({ PK: 'PRODUCT#p-9', SK: 'METADATA', name: 'Lock', type: 'product' })).toEqual({
      GSI3PK: 'PRODUCTS#STOCK',
      GSI3SK: 'lock#p-9',
    });
  });
});

describe('stockIndexChange', () => {
  const managed = { PK: 'PRODUCT#p-1', SK: 'METADATA', id: 'p-1', name: 'Lock', type: 'product' };

  it('changes nothing on a row that already carries the right keys', () => {
    expect(stockIndexChange({ ...managed, GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'lock#p-1' })).toBeNull();
  });

  it('sets the keys on a managed row that lacks them or carries a stale name', () => {
    expect(stockIndexChange(managed)).toEqual({ set: { GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'lock#p-1' } });
    expect(stockIndexChange({ ...managed, GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'old#p-1' })).toEqual({
      set: { GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'lock#p-1' },
    });
  });

  it('removes the keys from a row that stopped being stock-managed', () => {
    expect(
      stockIndexChange({ ...managed, manageStock: false, GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'lock#p-1' }),
    ).toEqual({ remove: true });
    expect(
      stockIndexChange({ ...managed, type: 'service', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'lock#p-1' }),
    ).toEqual({ remove: true });
  });

  it('leaves an unmanaged row without keys alone', () => {
    expect(stockIndexChange({ ...managed, manageStock: false })).toBeNull();
  });
});

describe('stockIndexWriteCondition', () => {
  it('requires the row to still hold the name, type, flag and sort key it was judged on', () => {
    expect(
      stockIndexWriteCondition({
        PK: 'PRODUCT#p-1',
        SK: 'METADATA',
        name: 'Lock',
        type: 'product',
        manageStock: true,
        GSI3SK: 'old#p-1',
      }),
    ).toEqual({
      ConditionExpression:
        'attribute_exists(PK) AND #name = :seenName AND #type = :seenType AND manageStock = :seenManage AND GSI3SK = :seenSk',
      ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
      ExpressionAttributeValues: {
        ':seenName': 'Lock',
        ':seenType': 'product',
        ':seenManage': true,
        ':seenSk': 'old#p-1',
      },
    });
  });

  it('requires absent attributes to be absent still', () => {
    expect(stockIndexWriteCondition({ PK: 'PRODUCT#p-1', SK: 'METADATA' })).toEqual({
      ConditionExpression:
        'attribute_exists(PK) AND attribute_not_exists(#name) AND attribute_not_exists(#type) AND ' +
        '(attribute_not_exists(manageStock) OR attribute_type(manageStock, :nullType)) AND attribute_not_exists(GSI3SK)',
      ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
      ExpressionAttributeValues: { ':nullType': 'NULL' },
    });
  });
});

/** Один запис, який шлють і репозиторій після оновлення, і backfill:product-stock-index. */
describe('stockIndexWrite', () => {
  it('builds the conditional SET for a row to file', () => {
    expect(stockIndexWrite({ PK: 'PRODUCT#p-1', SK: 'METADATA', name: 'Lock', type: 'product' })).toEqual({
      kind: 'set',
      Key: { PK: 'PRODUCT#p-1', SK: 'METADATA' },
      UpdateExpression: 'SET GSI3PK = :stockPk, GSI3SK = :stockSk',
      ConditionExpression:
        'attribute_exists(PK) AND #name = :seenName AND #type = :seenType AND ' +
        '(attribute_not_exists(manageStock) OR attribute_type(manageStock, :nullType)) AND attribute_not_exists(GSI3SK)',
      ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
      ExpressionAttributeValues: {
        ':stockPk': 'PRODUCTS#STOCK',
        ':stockSk': 'lock#p-1',
        ':seenName': 'Lock',
        ':seenType': 'product',
        ':nullType': 'NULL',
      },
    });
  });

  it('builds the conditional REMOVE for a row to take off', () => {
    const write = stockIndexWrite({
      PK: 'PRODUCT#p-1',
      SK: 'METADATA',
      name: 'Lock',
      type: 'product',
      manageStock: false,
      GSI3PK: 'PRODUCTS#STOCK',
      GSI3SK: 'lock#p-1',
    });

    expect(write?.kind).toBe('remove');
    expect(write?.UpdateExpression).toBe('REMOVE GSI3PK, GSI3SK');
    expect(write?.ExpressionAttributeValues).toEqual({
      ':seenName': 'Lock',
      ':seenType': 'product',
      ':seenManage': false,
      ':seenSk': 'lock#p-1',
    });
  });

  it('is null when the row is already right', () => {
    expect(
      stockIndexWrite({ PK: 'PRODUCT#p-1', SK: 'METADATA', name: 'Lock', type: 'product', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'lock#p-1' }),
    ).toBeNull();
  });
});
