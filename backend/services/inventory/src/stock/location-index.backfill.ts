import {
  LOCATION_INDEX_PK,
  locationSortKey,
} from '../common/constants/locations.constants';

/** The attributes of a stored row the location index is derived from. */
export interface LocationIndexRow {
  PK: string;
  SK: string;
  id?: string;
  name?: string;
  technicianName?: string;
  GSI1PK?: string;
  GSI1SK?: string;
}

export interface LocationIndexKeys {
  GSI1PK: string;
  GSI1SK: string;
}

const PREFIXES: Array<{ prefix: string; indexPk: string; kind: 'warehouse' | 'container' }> = [
  { prefix: 'WAREHOUSE#', indexPk: LOCATION_INDEX_PK.warehouse, kind: 'warehouse' },
  { prefix: 'CONTAINER#', indexPk: LOCATION_INDEX_PK.container, kind: 'container' },
];

/**
 * The index keys ContainersRepository / WarehousesRepository would have
 * written for this row, or null when the row is not location metadata. Pure,
 * so the backfill's decision can be tested without DynamoDB.
 */
export function expectedLocationIndexKeys(row: LocationIndexRow): LocationIndexKeys | null {
  if (row.SK !== 'METADATA') return null;
  const match = PREFIXES.find((p) => row.PK.startsWith(p.prefix));
  if (!match) return null;

  const id = row.id ?? row.PK.slice(match.prefix.length);
  // A container written before containers had a name is listed under the
  // technician-derived label, so it sorts where the list shows it.
  const name =
    row.name ??
    (match.kind === 'container'
      ? row.technicianName
        ? `${row.technicianName}'s van`
        : 'Container'
      : '');

  return { GSI1PK: match.indexPk, GSI1SK: locationSortKey(name, id) };
}

/** The keys to write, or null when the row already carries them (or is not a location). */
export function locationIndexKeysToWrite(row: LocationIndexRow): LocationIndexKeys | null {
  const expected = expectedLocationIndexKeys(row);
  if (!expected) return null;
  if (row.GSI1PK === expected.GSI1PK && row.GSI1SK === expected.GSI1SK) return null;
  return expected;
}
