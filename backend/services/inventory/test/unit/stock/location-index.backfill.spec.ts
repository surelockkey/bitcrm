import {
  expectedLocationIndexKeys,
  locationIndexKeysToWrite,
} from 'src/stock/location-index.backfill';

/**
 * Rows written before the location index existed (the Workiz import, and every
 * container and warehouse created before this change) carry no GSI1 keys, so
 * the list Query cannot see them. The backfill gives each one the keys the
 * repositories would have written.
 */
describe('expectedLocationIndexKeys', () => {
  it('gives a container row the container partition and the name#id sort key', () => {
    expect(
      expectedLocationIndexKeys({ PK: 'CONTAINER#c-1', SK: 'METADATA', id: 'c-1', name: ' (12) MIKE' }),
    ).toEqual({ GSI1PK: 'LOCATION#CONTAINER', GSI1SK: '(12) mike#c-1' });
  });

  it('gives a warehouse row the warehouse partition', () => {
    expect(
      expectedLocationIndexKeys({ PK: 'WAREHOUSE#wh-1', SK: 'METADATA', id: 'wh-1', name: '(1) STORE' }),
    ).toEqual({ GSI1PK: 'LOCATION#WAREHOUSE', GSI1SK: '(1) store#wh-1' });
  });

  it('takes the id from the PK when the row has none', () => {
    expect(
      expectedLocationIndexKeys({ PK: 'WAREHOUSE#wh-1', SK: 'METADATA', name: 'Store' }),
    ).toEqual({ GSI1PK: 'LOCATION#WAREHOUSE', GSI1SK: 'store#wh-1' });
  });

  it('sorts a container written before containers had a name by the label it is shown with', () => {
    expect(
      expectedLocationIndexKeys({
        PK: 'CONTAINER#c-1',
        SK: 'METADATA',
        id: 'c-1',
        technicianName: 'Mike Ross',
      }),
    ).toEqual({ GSI1PK: 'LOCATION#CONTAINER', GSI1SK: "mike ross's van#c-1" });
    expect(
      expectedLocationIndexKeys({ PK: 'CONTAINER#c-1', SK: 'METADATA', id: 'c-1' }),
    ).toEqual({ GSI1PK: 'LOCATION#CONTAINER', GSI1SK: 'container#c-1' });
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
  };

  it('writes nothing for a row that already carries the right keys', () => {
    expect(locationIndexKeysToWrite(row)).toBeNull();
  });

  it('writes the keys for a row that has none', () => {
    const { GSI1PK: _pk, GSI1SK: _sk, ...bare } = row;
    expect(locationIndexKeysToWrite(bare)).toEqual({
      GSI1PK: 'LOCATION#CONTAINER',
      GSI1SK: 'van 1#c-1',
    });
  });

  it('rewrites a stale sort key (renamed before the index existed)', () => {
    expect(locationIndexKeysToWrite({ ...row, name: 'Van 2' })).toEqual({
      GSI1PK: 'LOCATION#CONTAINER',
      GSI1SK: 'van 2#c-1',
    });
  });

  it('leaves non-location rows alone', () => {
    expect(locationIndexKeysToWrite({ PK: 'BRAND#b-1', SK: 'METADATA', name: 'Schlage' })).toBeNull();
  });
});
