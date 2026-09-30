/**
 * Which stock locations a user works from — the Workiz "User containers"
 * setting. A user has exactly one current container, or every location, or
 * none; a container may be shared by many users.
 */
export enum UserContainerAccess {
  /** One container: `UserContainer.containerId`. */
  CONTAINER = 'container',
  /** Every location ("All locations"). */
  ALL = 'all',
  /** No stock location at all ("No access"). */
  NONE = 'none',
}
