import { productSearchKeysToWrite } from 'src/products/product-search.backfill';
import { productSearchName, productSearchSku } from 'src/products/products.constants';

/**
 * Пошук товарів іде по `searchName` / `searchSku` (назва й SKU в нижньому
 * регістрі): рядки, записані до появи цих полів — і кожен імпорт Workiz —
 * їх не мають і не знаходяться, доки бекфіл їх не допише.
 */
describe('product search attributes', () => {
  it('lowercase and trim the name and the sku', () => {
    expect(productSearchName('  Kwikset Deadbolt ')).toBe('kwikset deadbolt');
    expect(productSearchSku(' WZ-10707 ')).toBe('wz-10707');
  });
});

describe('productSearchKeysToWrite', () => {
  const row = {
    PK: 'PRODUCT#p-1',
    SK: 'METADATA',
    name: 'Kwikset Deadbolt',
    sku: 'WZ-10707',
    searchName: 'kwikset deadbolt',
    searchSku: 'wz-10707',
  };

  it('writes nothing for a row that already carries the right attributes', () => {
    expect(productSearchKeysToWrite(row)).toBeNull();
  });

  it('writes both for a row that has none', () => {
    const { searchName: _n, searchSku: _s, ...bare } = row;
    expect(productSearchKeysToWrite(bare)).toEqual({ searchName: 'kwikset deadbolt', searchSku: 'wz-10707' });
  });

  it('rewrites a stale search name (renamed before the attribute existed)', () => {
    expect(productSearchKeysToWrite({ ...row, name: 'Schlage Deadbolt' })).toEqual({
      searchName: 'schlage deadbolt',
      searchSku: 'wz-10707',
    });
  });

  it('tolerates a row with no name or sku', () => {
    expect(productSearchKeysToWrite({ PK: 'PRODUCT#p-2', SK: 'METADATA' })).toEqual({
      searchName: '',
      searchSku: '',
    });
  });

  it('leaves non-product rows alone', () => {
    expect(productSearchKeysToWrite({ PK: 'SKU#WZ-1', SK: 'PRODUCT', name: 'x' })).toBeNull();
    expect(productSearchKeysToWrite({ PK: 'CONTAINER#c-1', SK: 'METADATA', name: 'Van' })).toBeNull();
  });
});
