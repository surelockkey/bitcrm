import {
  LOCATION_INDEX_PK,
  locationSearchName,
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
  searchName?: string;
}

export interface LocationIndexKeys {
  GSI1PK: string;
  GSI1SK: string;
  /** What the list's `search` filter matches — the name alone, never the id. */
  searchName: string;
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

  return {
    GSI1PK: match.indexPk,
    GSI1SK: locationSortKey(name, id),
    searchName: locationSearchName(name),
  };
}

/** The keys to write, or null when the row already carries them (or is not a location). */
export function locationIndexKeysToWrite(row: LocationIndexRow): LocationIndexKeys | null {
  const expected = expectedLocationIndexKeys(row);
  if (!expected) return null;
  if (
    row.GSI1PK === expected.GSI1PK &&
    row.GSI1SK === expected.GSI1SK &&
    row.searchName === expected.searchName
  ) {
    return null;
  }
  return expected;
}

/**
 * The condition the backfill's write carries: the row must still look the way
 * the scan saw it. A rename that lands between the scan and the write has
 * already written a newer sort key, and overwriting it would list the location
 * under its old name until the next rename. The write is skipped instead.
 */
export function locationIndexWriteCondition(row: LocationIndexRow): {
  ConditionExpression: string;
  ExpressionAttributeValues: Record<string, unknown>;
} {
  if (typeof row.GSI1SK === 'string') {
    return {
      ConditionExpression: 'attribute_exists(PK) AND GSI1SK = :seen',
      ExpressionAttributeValues: { ':seen': row.GSI1SK },
    };
  }
  return {
    ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(GSI1SK)',
    ExpressionAttributeValues: {},
  };
}
