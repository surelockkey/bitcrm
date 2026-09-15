import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The permissions `PermissionGuard` resolved for this request (it stores
 * them on `req.resolvedPermissions` when a `@RequirePermission` is present).
 * Same decorator deal-service carries; the send path reads the data scope
 * and the `team_chat.send` grant off it.
 */
export const ResolvedPerms = createParamDecorator((data: string | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return data ? request.resolvedPermissions?.[data] : request.resolvedPermissions;
});
