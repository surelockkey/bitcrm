import { BadRequestException } from '@nestjs/common';
import {
  PRODUCT_CATALOG_INDEX_PK,
  expectedCatalogIndexKeys,
  catalogIndexWriteCondition,
  catalogIndexWrite,
  planCatalogIndexBackfill,
  decodeCatalogCursor,
} from 'src/products/product-catalog-index';

const encode = (key: unknown) => Buffer.from(JSON.stringify(key)).toString('base64url');

/**
 * Price Book — усі позиції каталогу (16 142 на dev: товари, послуги, other/hours,
 * активні й архівні) у порядку назви. Без категорії й без manageStock=true список
 * був фільтрованим Scan по спільній таблиці (46 тис. рядків): короткі або порожні
 * сторінки з курсором. Кожен рядок PRODUCT#/METADATA отримує ключі розділу
 * `PRODUCTS#ALL` на GSI4 (TransferEntityIndex).
 */
describe('expectedCatalogIndexKeys', () => {
  const row = { PK: 'PRODUCT#p-1', SK: 'METADATA', id: 'p-1', name: ' Kwikset Deadbolt ', type: 'product' };

  it('keys every product row by its lowercased name, whatever its type, status or stock flag', () => {
    const keys = { GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'kwikset deadbolt#p-1' };
    expect(PRODUCT_CATALOG_INDEX_PK).toBe('PRODUCTS#ALL');
    expect(expectedCatalogIndexKeys(row)).toEqual(keys);
    expect(expectedCatalogIndexKeys({ ...row, type: 'service' })).toEqual(keys);
    expect(expectedCatalogIndexKeys({ ...row, type: 'hours' })).toEqual(keys);
    expect(expectedCatalogIndexKeys({ ...row, type: undefined })).toEqual(keys);
    expect(expectedCatalogIndexKeys({ ...row, status: 'archived' })).toEqual(keys);
    expect(expectedCatalogIndexKeys({ ...row, manageStock: false })).toEqual(keys);
  });

  it('keys nothing that is not product metadata', () => {
    expect(expectedCatalogIndexKeys({ PK: 'CONTAINER#c-1', SK: 'METADATA', name: 'Van' })).toBeNull();
    expect(expectedCatalogIndexKeys({ PK: 'SKU#WZ-1', SK: 'PRODUCT', name: 'x' })).toBeNull();
    expect(expectedCatalogIndexKeys({ PK: 'PRODUCT#p-1', SK: 'STOCK#x', name: 'x' })).toBeNull();
  });

  it('takes the id from the PK when the row has none, and tolerates a row with no name', () => {
    expect(expectedCatalogIndexKeys({ PK: 'PRODUCT#p-9', SK: 'METADATA', name: 'Lock' })).toEqual({
      GSI4PK: 'PRODUCTS#ALL',
      GSI4SK: 'lock#p-9',
    });
    expect(expectedCatalogIndexKeys({ PK: 'PRODUCT#p-9', SK: 'METADATA' })).toEqual({
      GSI4PK: 'PRODUCTS#ALL',
      GSI4SK: '#p-9',
    });
  });

  // Ключ індексу DynamoDB — до 1 024 байтів; довша назва відхилила б увесь запис.
  it('orders by the first 200 characters of the name, so the key never outgrows an index key', () => {
    const long = 'Ä'.repeat(300);
    const keys = expectedCatalogIndexKeys({ ...row, name: long })!;
    expect(keys.GSI4SK).toBe(`${'ä'.repeat(200)}#p-1`);
    expect(Buffer.byteLength(keys.GSI4SK)).toBeLessThan(1024);
  });
});

describe('catalogIndexWriteCondition', () => {
  it('requires the row to still hold the name and sort key it was judged on', () => {
    expect(
      catalogIndexWriteCondition({ PK: 'PRODUCT#p-1', SK: 'METADATA', name: 'Lock', GSI4SK: 'old#p-1' }),
    ).toEqual({
      ConditionExpression: 'attribute_exists(PK) AND #name = :seenName AND GSI4SK = :seenCatalogSk',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: { ':seenName': 'Lock', ':seenCatalogSk': 'old#p-1' },
    });
  });

  it('requires absent attributes to be absent still', () => {
    expect(catalogIndexWriteCondition({ PK: 'PRODUCT#p-1', SK: 'METADATA' })).toEqual({
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#name) AND attribute_not_exists(GSI4SK)',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {},
    });
  });
});

/** Один запис, який шлють і репозиторій після оновлення, і backfill:product-catalog-index. */
describe('catalogIndexWrite', () => {
  it('builds the conditional SET for a row without the keys', () => {
    expect(catalogIndexWrite({ PK: 'PRODUCT#p-1', SK: 'METADATA', name: 'Lock' })).toEqual({
      Key: { PK: 'PRODUCT#p-1', SK: 'METADATA' },
      UpdateExpression: 'SET GSI4PK = :catalogPk, GSI4SK = :catalogSk',
      ConditionExpression: 'attribute_exists(PK) AND #name = :seenName AND attribute_not_exists(GSI4SK)',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':catalogPk': 'PRODUCTS#ALL',
        ':catalogSk': 'lock#p-1',
        ':seenName': 'Lock',
      },
    });
  });

  it('re-files a renamed row under its new name', () => {
    const write = catalogIndexWrite({
      PK: 'PRODUCT#p-1',
      SK: 'METADATA',
      name: 'Door Chain',
      GSI4PK: 'PRODUCTS#ALL',
      GSI4SK: 'chain guard#p-1',
    });

    expect(write?.ExpressionAttributeValues).toEqual({
      ':catalogPk': 'PRODUCTS#ALL',
      ':catalogSk': 'door chain#p-1',
      ':seenName': 'Door Chain',
      ':seenCatalogSk': 'chain guard#p-1',
    });
  });

  it('is null when the row is already filed right, and for a row that is not a product', () => {
    expect(
      catalogIndexWrite({ PK: 'PRODUCT#p-1', SK: 'METADATA', name: 'Lock', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'lock#p-1' }),
    ).toBeNull();
    expect(catalogIndexWrite({ PK: 'TRANSFER#t-1', SK: 'METADATA', GSI4PK: 'ENTITY#x', GSI4SK: 'y' })).toBeNull();
  });
});

describe('planCatalogIndexBackfill', () => {
  it('writes the rows that need filing and counts the ones already filed', () => {
    const plan = planCatalogIndexBackfill([
      { PK: 'PRODUCT#p-1', SK: 'METADATA', name: 'Lock' },
      { PK: 'PRODUCT#p-2', SK: 'METADATA', name: 'Key', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'key#p-2' },
      { PK: 'PRODUCT#p-3', SK: 'METADATA', name: 'New Name', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'old name#p-3' },
      { PK: 'SKU#WZ-1', SK: 'PRODUCT' },
    ]);

    expect(plan.writes.map((w) => w.Key.PK)).toEqual(['PRODUCT#p-1', 'PRODUCT#p-3']);
    expect(plan.alreadyFiled).toBe(1);
    expect(plan.notProducts).toBe(1);
  });

  it('plans nothing for an empty page', () => {
    expect(planCatalogIndexBackfill([])).toEqual({ writes: [], alreadyFiled: 0, notProducts: 0 });
  });
});

/** Курсор Price Book — ключі GSI4 саме цього розділу; все інше — 400, а не 500 від DynamoDB. */
describe('decodeCatalogCursor', () => {
  const key = { PK: 'PRODUCT#p-1', SK: 'METADATA', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'lock#p-1' };

  it('resumes from a cursor it handed out', () => {
    expect(decodeCatalogCursor(encode(key))).toEqual(key);
    expect(decodeCatalogCursor(undefined)).toBeUndefined();
  });

  it('refuses garbage, a Scan-era cursor, a stock-partition cursor and a GSI4 key of another partition', () => {
    expect(() => decodeCatalogCursor('%%%')).toThrow(BadRequestException);
    expect(() => decodeCatalogCursor(encode({ PK: 'PRODUCT#p-1', SK: 'METADATA' }))).toThrow(BadRequestException);
    expect(() =>
      decodeCatalogCursor(encode({ PK: 'PRODUCT#p-1', SK: 'METADATA', GSI3PK: 'PRODUCTS#STOCK', GSI3SK: 'lock#p-1' })),
    ).toThrow(BadRequestException);
    expect(() =>
      decodeCatalogCursor(encode({ ...key, GSI4PK: 'INVLOG#PRODUCT#p-1', GSI4SK: '2026-09-01T00:00:00.000Z#x' })),
    ).toThrow(BadRequestException);
  });
});
