import { UserContainerAccess, type UserContainer } from '@bitcrm/types';

/** Assignment rows live in the shared BitCRM_Inventory table beside the containers. */
export const USER_CONTAINER_PK_PREFIX = 'USER_CONTAINER#';
export const USER_CONTAINER_SK = 'METADATA';
/** Partition of the list on the existing GSI1 (CategoryIndex) — the catalog pattern. */
export const USER_CONTAINER_GSI1PK = 'CATALOG#USER_CONTAINER';
/**
 * Partition of "who works from this van" on GSI3 (OwnerIndex). The container
 * rows already hold `OWNER#<technicianId>` partitions there; the prefix is
 * different, so the two never meet.
 */
export const CONTAINER_USERS_PK_PREFIX = 'CONTAINER_USERS#';

/** The list sort key: name order, the user id keeping two "Mike"s apart. */
export function userContainerSortKey(userName: string, userId: string): string {
  return `${userName.trim().toLowerCase()}#${userId}`;
}

/**
 * The stored row of an assignment — its attributes plus every key — shared by
 * the repository and `backfill:user-containers` so both write the same shape.
 * The GSI3 pair exists only for `access: container`: a row put without it
 * (the repository always replaces the whole row) leaves that van's user list.
 */
export function userContainerItem(row: UserContainer): Record<string, unknown> {
  return {
    ...row,
    PK: `${USER_CONTAINER_PK_PREFIX}${row.userId}`,
    SK: USER_CONTAINER_SK,
    GSI1PK: USER_CONTAINER_GSI1PK,
    GSI1SK: userContainerSortKey(row.userName, row.userId),
    ...(row.access === UserContainerAccess.CONTAINER && row.containerId
      ? {
          GSI3PK: `${CONTAINER_USERS_PK_PREFIX}${row.containerId}`,
          GSI3SK: `USER#${row.userId}`,
        }
      : {}),
  };
}
