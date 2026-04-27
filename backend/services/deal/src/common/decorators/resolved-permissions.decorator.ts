import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ResolvedPerms = createParamDecorator(
  (data: string, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return data
      ? request.resolvedPermissions?.[data]
      : request.resolvedPermissions;
  },
);
