import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from '@bitcrm/shared';
import { InternalGuard } from '../guards/internal.guard';

/** Bypasses Cognito auth and requires the shared internal secret instead. */
export function Internal() {
  return applyDecorators(Public(), UseGuards(InternalGuard));
}
