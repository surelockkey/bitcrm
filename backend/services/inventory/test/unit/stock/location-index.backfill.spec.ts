import {
  expectedLocationIndexKeys,
  locationIndexKeysToWrite,
  locationIndexWriteCondition,
} from 'src/stock/location-index.backfill';

/**
 * Rows written before the location index existed (the Workiz import, and every
 * container and warehouse created before this change) carry no GSI1 keys, so
 * the list Query cannot see them. The backfill gives each one the keys the
 * repositories would have written — and the `searchName` the search filter
 * runs against, since the sort key carries the id and cannot be searched.
 */
describe('expectedLocationIndexKeys', () => {
  it('gives a container row the container partition, the name#id sort key and the search name', () => {
    expect(
      expectedLocationIndexKeys({ PK: 'CONTAINER#c-1', SK: 'METADATA', id: 'c-1', name: ' (12) MIKE' }),
    ).toEqual({ GSI1PK: 'LOCATION#CONTAINER', GSI1SK: '(12) mike#c-1', searchName: '(12) mike' });
  });

  it('gives a warehouse row the warehouse partition', () => {
    expect(
      expectedLocationIndexKeys({ PK: 'WAREHOUSE#wh-1', SK: 'METADATA', id: 'wh-1', name: '(1) STORE' }),
    ).toEqual({ GSI1PK: 'LOCATION#WAREHOUSE', GSI1SK: '(1) store#wh-1', searchName: '(1) store' });
  });

  it('takes the id from the PK when the row has none', () => {
    expect(
      expectedLocationIndexKeys({ PK: 'WAREHOUSE#wh-1', SK: 'METADATA', name: 'Store' }),
    ).toEqual({ GSI1PK: 'LOCATION#WAREHOUSE', GSI1SK: 'store#wh-1', searchName: 'store' });
  });

  it('sorts a container written before containers had a name by the label it is shown with', () => {
    expect(
      expectedLocationIndexKeys({
        PK: 'CONTAINER#c-1',
        SK: 'METADATA',
        id: 'c-1',
        technicianName: 'Mike Ross',
      }),
    ).toEqual({
      GSI1PK: 'LOCATION#CONTAINER',
      GSI1SK: "mike ross's van#c-1",
      searchName: "mike ross's van",
    });
    expect(
      expectedLocationIndexKeys({ PK: 'CONTAINER#c-1', SK: 'METADATA', id: 'c-1' }),
    ).toEqual({ GSI1PK: 'LOCATION#CONTAINER', GSI1SK: 'container#c-1', searchName: 'container' });
  });

  it('answers null for anything that is not a location metadata row', () => {
    expect(expectedLocationIndexKeys({ PK: 'PRODUCT#p-1', SK: 'METADATA', name: 'Lock' })).toBeNull();
    expect(expectedLocationIndexKeys({ PK: 'CONTAINER#c-1', SK: 'STOCK#p-1' })).toBeNull();
  });
});

describe('locationIndexKeysToWrite', () => {
  const row = {
    PK: 'CONTAINER#c-1',
    SK: 'METADATA',
    id: 'c-1',
    name: 'Van 1',
    GSI1PK: 'LOCATION#CONTAINER',
    GSI1SK: 'van 1#c-1',
    searchName: 'van 1',
  };

  it('writes nothing for a row that already carries the right keys', () => {
    expect(locationIndexKeysToWrite(row)).toBeNull();
  });

  it('writes the keys for a row that has none', () => {
    const { GSI1PK: _pk, GSI1SK: _sk, searchName: _sn, ...bare } = row;
    expect(locationIndexKeysToWrite(bare)).toEqual({
      GSI1PK: 'LOCATION#CONTAINER',
      GSI1SK: 'van 1#c-1',
      searchName: 'van 1',
    });
  });

  // Рядки з індексом, але без searchName — записані між двома версіями коду.
  it('writes the keys for a row indexed before the search name existed', () => {
    const { searchName: _sn, ...noSearch } = row;
    expect(locationIndexKeysToWrite(noSearch)).toEqual({
      GSI1PK: 'LOCATION#CONTAINER',
      GSI1SK: 'van 1#c-1',
      searchName: 'van 1',
    });
  });

  it('rewrites a stale sort key (renamed before the index existed)', () => {
    expect(locationIndexKeysToWrite({ ...row, name: 'Van 2' })).toEqual({
      GSI1PK: 'LOCATION#CONTAINER',
      GSI1SK: 'van 2#c-1',
      searchName: 'van 2',
    });
  });

  it('leaves non-location rows alone', () => {
    expect(locationIndexKeysToWrite({ PK: 'BRAND#b-1', SK: 'METADATA', name: 'Schlage' })).toBeNull();
  });
});

/**
 * Рішення бекфілу приймається зі знімка Scan-у; запис має вимагати, щоб той
 * знімок і досі був актуальним, інакше перейменування, що встигло між
 * читанням і записом, повертається назад під старою назвою.
 */
describe('locationIndexWriteCondition', () => {
  it('requires the sort key the scan saw to still be there', () => {
    expect(
      locationIndexWriteCondition({ PK: 'CONTAINER#c-1', SK: 'METADATA', GSI1SK: 'old#c-1' }),
    ).toEqual({
      ConditionExpression: 'attribute_exists(PK) AND GSI1SK = :seen',
      ExpressionAttributeValues: { ':seen': 'old#c-1' },
    });
  });

  it('requires the row to still have no sort key when the scan saw none', () => {
    expect(locationIndexWriteCondition({ PK: 'CONTAINER#c-1', SK: 'METADATA' })).toEqual({
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(GSI1SK)',
      ExpressionAttributeValues: {},
    });
  });
});
