import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from '@bitcrm/shared';
import { InternalGuard } from '../guards/internal.guard';

export function Internal() {
  return applyDecorators(Public(), UseGuards(InternalGuard));
}
