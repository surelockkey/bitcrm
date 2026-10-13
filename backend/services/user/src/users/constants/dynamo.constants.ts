export const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
export const GSI1_NAME = 'RoleIndex';
export const GSI2_NAME = 'DepartmentIndex';

/**
 * The all-users index: every `USER#<id> / METADATA` row (any status) carries
 *   GSI3PK = USERS#ALL, GSI3SK = USER#<id>
 * on TechnicianIndex (GSI3). User rows held no GSI3 keys before, and the
 * technician rows that do live on the `TECHNICIAN` partition, so neither
 * reader sees the other. Ordered by id — never re-keyed by a rename.
 *
 * Gated on `USERSALLINDEX / STATE { readyAt, count }`, stamped by
 * `backfill:users-all-index -- --apply`; until then the "all users" reads keep
 * the table Scan.
 */
export const GSI3_NAME = 'TechnicianIndex';
export const ALL_USERS_GSI_PK = 'USERS#ALL';
export const allUsersGsiSk = (id: string) => `USER#${id}`;
export const ALL_USERS_INDEX_STATE_KEY = { PK: 'USERSALLINDEX', SK: 'STATE' } as const;
