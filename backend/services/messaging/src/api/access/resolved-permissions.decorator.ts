import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The `ResolvedPermissions` the `PermissionGuard` stored on the request —
 * same decorator deal and crm carry. `undefined` on routes without
 * `@RequirePermission` (the guard never resolved anything for them).
 */
export const ResolvedPerms = createParamDecorator((data: string, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return data ? request.resolvedPermissions?.[data] : request.resolvedPermissions;
});
