import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from '@bitcrm/shared';
import { InternalGuard } from '../guards/internal.guard';

/** Marks a route as internal (service-to-service): skips JWT auth, requires the internal secret. */
export function Internal() {
  return applyDecorators(Public(), UseGuards(InternalGuard));
}
