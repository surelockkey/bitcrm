import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The permission set `PermissionGuard` already resolved for this request.
 *
 * Only populated on handlers carrying `@RequirePermission` — the guard returns
 * early for undecorated routes without resolving anything. Handlers that read
 * this to make a field-level decision must therefore treat `undefined` as
 * "denied" rather than "unrestricted"; `hasPermission()` from `@bitcrm/shared`
 * does exactly that.
 *
 * Mirrors deal-service's decorator of the same name.
 */
export const ResolvedPerms = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return data
      ? request.resolvedPermissions?.[data]
      : request.resolvedPermissions;
  },
);
