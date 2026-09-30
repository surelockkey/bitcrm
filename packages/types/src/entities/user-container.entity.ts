import { UserContainerAccess } from '../enums/user-container-access.enum';

/**
 * A user's container assignment (Workiz "User containers"). One row per
 * user; a container can be named by many rows. Reassigning a van — a tech
 * taking another tech's van — is a new `containerId` here, and the inventory
 * audit log records it as `container_assigned`.
 */
export interface UserContainer {
  userId: string;
  /** Display-name snapshot; the web may re-resolve it from the users directory. */
  userName: string;
  access: UserContainerAccess;
  /** The one container, when `access` is `container`; absent otherwise. */
  containerId?: string;
  /** Name snapshot of that container, taken when the assignment was saved. */
  containerName?: string;
  /**
   * Workiz `user_limited`: the user may use their own container only.
   * Meaningful with `access: container`; always stored `false` otherwise.
   */
  limited: boolean;
  updatedAt: string;
  /** Who saved the assignment last (user id); `system` on rows the backfill wrote. */
  updatedBy?: string;
  /** Their email, as transfers name the performer. */
  updatedByName?: string;
}
