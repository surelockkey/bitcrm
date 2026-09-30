import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Caller } from './access';

/** `{ user, perms }` of the request — what billing services take for scope checks. */
export const CallerCtx = createParamDecorator((_: unknown, ctx: ExecutionContext): Caller => {
  const req = ctx.switchToHttp().getRequest();
  return { user: req.user, perms: req.resolvedPermissions ?? null };
});
