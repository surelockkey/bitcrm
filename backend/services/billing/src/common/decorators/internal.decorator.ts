import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from '@bitcrm/shared';
import { InternalGuard } from '../guards/internal.guard';

/** `@Public()` + `InternalGuard`: a route only other services may call. */
export function Internal() {
  return applyDecorators(Public(), UseGuards(InternalGuard));
}
