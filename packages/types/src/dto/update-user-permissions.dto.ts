import { UserPermissionOverrides } from '../permissions/permission-matrix';

/**
 * Body of PUT /users/:id/permissions — the sparse override object itself,
 * sent flat (not wrapped), mirroring the user service's SetPermissionOverridesDto.
 */
export type UpdateUserPermissionsRequest = UserPermissionOverrides;
