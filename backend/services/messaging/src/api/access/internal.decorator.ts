import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from '@bitcrm/shared';
import { InternalGuard } from './internal.guard';

/** `@Public()` + `InternalGuard` — authenticated by `x-internal-secret`, not Cognito. */
export function Internal() {
  return applyDecorators(Public(), UseGuards(InternalGuard));
}
