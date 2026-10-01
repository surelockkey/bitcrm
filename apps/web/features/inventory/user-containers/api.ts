import type { UserContainer, UserContainerAccess } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { readAllPages } from "@/features/inventory/read-all";

/**
 * Workiz "User containers": which van each user works from — exactly one, or
 * "All locations", or "No access". A van may be shared by many users.
 */

/** `PUT /inventory/user-containers/:userId` — the whole assignment, replaced. */
export interface AssignUserContainerBody {
  /** Display-name snapshot the row keeps. */
  userName: string;
  access: UserContainerAccess;
  /** Required with `access: container`; the van must be active. */
  containerId?: string;
  /** Workiz "limited": the user may use their own container only. */
  limited?: boolean;
}

/**
 * Every assignment row, in name order — one request for the whole team; a
 * cursor, should the endpoint start paging, is followed to the end.
 */
export function listUserContainers(): Promise<UserContainer[]> {
  return readAllPages<UserContainer>("/inventory/user-containers", {}, { pageSize: null });
}

/** The caller's own row; 404 when they have none. */
export function getMyUserContainer(): Promise<UserContainer> {
  return http.get<UserContainer>("/inventory/user-containers/me");
}

/** One user's row; 404 when they have none. */
export function getUserContainer(userId: string): Promise<UserContainer> {
  return http.get<UserContainer>(`/inventory/user-containers/${encodeURIComponent(userId)}`);
}

export function assignUserContainer(
  userId: string,
  body: AssignUserContainerBody,
): Promise<UserContainer> {
  return http.put<UserContainer>(`/inventory/user-containers/${encodeURIComponent(userId)}`, body);
}

/** The rows whose one container is this van. */
export function listContainerUsers(containerId: string): Promise<UserContainer[]> {
  return http.get<UserContainer[]>(`/inventory/containers/${encodeURIComponent(containerId)}/users`);
}
