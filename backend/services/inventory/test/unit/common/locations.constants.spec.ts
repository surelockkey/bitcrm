import {
  LOCATION_INDEX_PK,
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
});
