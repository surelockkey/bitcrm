import {
  LOCATION_INDEX_PK,
  locationSearchName,
  locationSortKey,
} from 'src/common/constants/locations.constants';

/**
 * Warehouses and containers are listed off GSI1 (CategoryIndex) the way the
 * brand catalog is: one constant partition per kind, the name as the sort key.
 * The id suffix keeps two "(3) VAN" rows apart and makes the key unique.
 */
describe('location index keys', () => {
  it('has one partition per location kind', () => {
    expect(LOCATION_INDEX_PK).toEqual({
      warehouse: 'LOCATION#WAREHOUSE',
      container: 'LOCATION#CONTAINER',
    });
  });

  it('sorts by the trimmed, lowercased name and suffixes the id', () => {
    expect(locationSortKey('  (12) MIKE ', 'container-1')).toBe('(12) mike#container-1');
  });

  it('keeps duplicate names apart', () => {
    expect(locationSortKey('Van', 'a')).not.toBe(locationSortKey('Van', 'b'));
  });

  // Пошук іде по назві, не по ключу сортування: у ключі є UUID, і будь-який
  // термін із цифр чи a-f ("3", "12", "de") збігався б з id майже кожного рядка.
  it('searches the trimmed, lowercased name alone — never the id', () => {
    expect(locationSearchName('  (12) MIKE ')).toBe('(12) mike');
    expect(locationSearchName('(3) VAN')).not.toContain('#');
  });
});
