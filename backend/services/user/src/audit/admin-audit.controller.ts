import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import type { AdminAuditTargetType } from '@bitcrm/types';
import { AdminAuditService, type AdminAuditQuery } from './admin-audit.service';

const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;
const TARGET_TYPES: readonly AdminAuditTargetType[] = ['user', 'role'];

@ApiTags('Audit')
@Controller('audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @RequirePermission('users', 'edit')
  @ApiOperation({
    summary: 'Who did what to a person or a role',
    description:
      '**Guard:** `users.edit` permission required. Newest first. `targetType` (user | role) + `targetId` ' +
      "for one subject's history, `actorId` for one admin's, neither for the whole trail. `limit` up to 200, " +
      'default 50; `cursor` is `pagination.nextCursor` of the previous page.',
  })
  async list(
    @Query()
    query: { targetType?: string; targetId?: string; actorId?: string; limit?: string; cursor?: string },
  ) {
    const n = Number(query.limit);
    const q: AdminAuditQuery = { limit: Number.isInteger(n) && n > 0 ? Math.min(n, PAGE_MAX) : PAGE_DEFAULT };
    if (TARGET_TYPES.includes(query.targetType as AdminAuditTargetType) && query.targetId) {
      q.targetType = query.targetType as AdminAuditTargetType;
      q.targetId = query.targetId;
    }
    if (query.actorId) q.actorId = query.actorId;
    if (query.cursor) q.cursor = query.cursor;
    const page = await this.audit.list(q);
    return { success: true, data: page.items, pagination: { nextCursor: page.nextCursor } };
  }
}
