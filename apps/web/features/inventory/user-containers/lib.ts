import { UserContainerAccess } from "@bitcrm/types";
import type { UserContainer } from "@bitcrm/types";
import type { StockLocation } from "@/features/inventory/stock/lib";

const ACCESS_LABELS: Record<UserContainerAccess, string> = {
  [UserContainerAccess.CONTAINER]: "Container",
  [UserContainerAccess.ALL]: "All locations",
  [UserContainerAccess.NONE]: "No access",
};

/** The Access column: the three Workiz choices, or "Not set" for someone never assigned. */
export function accessLabel(access: UserContainerAccess | null): string {
  return access ? ACCESS_LABELS[access] : "Not set";
}

/**
 * A row's person, by name. The import backfill wrote the user id as the name
 * for a van's secondary users, so a name equal to the id is looked up in the
 * directory — and left out rather than printed as a uuid when it can't be.
 */
export function nameOf(
  row: Pick<UserContainer, "userId" | "userName">,
  directory: Map<string, string>,
): string | undefined {
  const own = row.userName?.trim();
  if (own && own !== row.userId) return own;
  return directory.get(row.userId);
}

/** What a user works from, as the User containers tab shows it. */
export interface Assignment {
  /** `null` — never assigned. */
  access: UserContainerAccess | null;
  containerId?: string;
  containerName?: string;
  limited: boolean;
  /** No row: the van that names the user as its technician (the pre-assignment link). */
  legacy: boolean;
  updatedAt?: string;
  row?: UserContainer;
}

/**
 * The user's row decides whenever there is one — the server resolves them the
 * same way. Without a row, the van naming them as its technician is theirs.
 * The van's current name comes from the fleet; the row's is a snapshot.
 */
export function assignmentOf(
  userId: string,
  rows: Map<string, UserContainer>,
  vans: StockLocation[],
): Assignment {
  const row = rows.get(userId);
  const vanName = (id?: string) => (id ? vans.find((v) => v.type === "container" && v.id === id)?.name : undefined);
  if (row) {
    return {
      access: row.access,
      containerId: row.containerId,
      containerName: vanName(row.containerId) ?? row.containerName,
      limited: row.limited,
      legacy: false,
      updatedAt: row.updatedAt,
      row,
    };
  }
  const legacy = vans.find((v) => v.type === "container" && v.technicianId === userId);
  if (legacy) {
    return {
      access: UserContainerAccess.CONTAINER,
      containerId: legacy.id,
      containerName: legacy.name,
      limited: false,
      legacy: true,
    };
  }
  return { access: null, limited: false, legacy: false };
}

export interface ContainerUser {
  userId: string;
  /** `undefined` while the directory hasn't named them — never their id. */
  name?: string;
  /** Not an assignment: the van names them as its technician. */
  legacy?: boolean;
}

/** Who works from each van, by name — from the assignment rows. */
export function containerUserNames(
  rows: UserContainer[],
  directory: Map<string, string>,
): Map<string, ContainerUser[]> {
  const byVan = new Map<string, ContainerUser[]>();
  for (const r of rows) {
    if (r.access !== UserContainerAccess.CONTAINER || !r.containerId) continue;
    const list = byVan.get(r.containerId) ?? [];
    list.push({ userId: r.userId, name: nameOf(r, directory) });
    byVan.set(r.containerId, list);
  }
  for (const list of byVan.values()) {
    list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }
  return byVan;
}

/**
 * Who works from one van: the users whose row names it. With none, the van's
 * own technician — the pre-assignment link — unless a row of theirs sends
 * them somewhere else.
 */
export function usersOfContainer(
  van: StockLocation,
  byVan: Map<string, ContainerUser[]>,
  rowsByUser: Map<string, UserContainer>,
): ContainerUser[] {
  const assigned = byVan.get(van.id);
  if (assigned?.length) return assigned;
  if (van.technicianId && !rowsByUser.has(van.technicianId)) {
    return [{ userId: van.technicianId, name: van.technicianName?.trim() || undefined, legacy: true }];
  }
  return [];
}

/** "Ann, Bob" and how many more: a cell shows two names and "+N". */
export function namesSummary(names: string[]): { text: string; more: number } {
  return { text: names.slice(0, 2).join(", "), more: Math.max(0, names.length - 2) };
}
