import { UserContainerAccess, type UserContainer } from '@bitcrm/types';

/** The attributes of a stored container row the assignments are derived from. */
export interface ContainerAccessRow {
  id: string;
  name?: string;
  technicianId?: string;
  technicianName?: string;
  /** Workiz `user_limited`, as the importer writes it. */
  userLimited?: boolean;
  /** The Workiz secondary users of the location (BitCRM user ids). */
  accessUserIds?: string[];
  status?: string;
  /** A Workiz placeholder for a location deleted in Workiz. */
  placeholder?: boolean;
}

export interface SkippedContainer {
  id: string;
  name: string;
  reason: 'archived' | 'placeholder';
}

export interface UserContainerConflict {
  userId: string;
  keptContainerId: string;
  skippedContainerId: string;
}

export interface UserContainerBackfillPlan {
  /** The assignment rows to write — only for users with no row yet. */
  rows: UserContainer[];
  /** A user found on a second container: the first one is kept. */
  conflicts: UserContainerConflict[];
  /** Users skipped because they already have an assignment row. */
  alreadyAssigned: number;
  /** Containers nobody is assigned to because they are not active vans. */
  skippedContainers: SkippedContainer[];
}

/** Who the backfill names as the author of the rows it writes. */
export const BACKFILL_ACTOR = { updatedBy: 'system', updatedByName: 'backfill:user-containers' } as const;

/** The label the lists show for a container written before containers had a name. */
function containerLabel(row: ContainerAccessRow): string {
  return row.name ?? (row.technicianName ? `${row.technicianName}'s van` : 'Container');
}

/**
 * Which assignment rows `backfill:user-containers` writes. Pure, so the
 * decision is tested without DynamoDB.
 *
 * Only active vans: an archived container or a Workiz placeholder is
 * skipped (and reported), so nobody is assigned to an inactive van. Every
 * remaining container's `technicianId` is assigned to it (named by
 * `technicianName`, else the id), then every id in its `accessUserIds` (named
 * by the id — the web resolves names from the users directory). Owners go
 * first, so a technician who is also a secondary user elsewhere keeps their
 * own van; otherwise the first container by name wins — never the order a
 * Scan happened to return — and the rest are reported as conflicts. A user
 * who already has a row is never touched — the backfill is upsert-only.
 */
export function planUserContainerBackfill(
  containers: ContainerAccessRow[],
  existingUserIds: ReadonlySet<string>,
  now: string,
): UserContainerBackfillPlan {
  const byName = [...containers].sort((a, b) => {
    const order = containerLabel(a).toLowerCase().localeCompare(containerLabel(b).toLowerCase());
    return order !== 0 ? order : a.id.localeCompare(b.id);
  });
  const skippedContainers: SkippedContainer[] = [];
  const active = byName.filter((container) => {
    const reason = container.placeholder === true ? 'placeholder' : container.status === 'archived' ? 'archived' : null;
    if (reason) skippedContainers.push({ id: container.id, name: containerLabel(container), reason });
    return !reason;
  });

  const candidates: Array<{ userId: string; userName: string; container: ContainerAccessRow }> = [];
  for (const container of active) {
    if (container.technicianId) {
      candidates.push({
        userId: container.technicianId,
        userName: container.technicianName ?? container.technicianId,
        container,
      });
    }
  }
  for (const container of active) {
    for (const userId of container.accessUserIds ?? []) {
      candidates.push({ userId, userName: userId, container });
    }
  }

  const planned = new Map<string, UserContainer>();
  const conflicts: UserContainerConflict[] = [];
  const already = new Set<string>();

  for (const { userId, userName, container } of candidates) {
    if (existingUserIds.has(userId)) {
      already.add(userId);
      continue;
    }
    const kept = planned.get(userId);
    if (kept) {
      if (kept.containerId !== container.id) {
        conflicts.push({ userId, keptContainerId: kept.containerId!, skippedContainerId: container.id });
      }
      continue;
    }
    planned.set(userId, {
      userId,
      userName,
      access: UserContainerAccess.CONTAINER,
      containerId: container.id,
      containerName: containerLabel(container),
      limited: container.userLimited === true,
      updatedAt: now,
      ...BACKFILL_ACTOR,
    });
  }

  return { rows: [...planned.values()], conflicts, alreadyAssigned: already.size, skippedContainers };
}
