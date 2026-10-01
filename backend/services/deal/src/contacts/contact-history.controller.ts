import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { ContactHistoryService } from './contact-history.service';

/** `limit` as the query gives it: default 30, clamped to 1–100, garbage → default. */
export function historyLimit(raw: string | number | undefined): number {
  if (raw === undefined || raw === '') return 30;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 30;
  return Math.min(Math.max(Math.trunc(n), 1), 100);
}

/**
 * The client card's History — every event of the client's jobs. Registered
 * ahead of DealsController so `GET /:id` never takes `/timeline`.
 */
@ApiTags('Contact History & Files')
@ApiBearerAuth()
@Controller('timeline/by-contact')
export class ContactHistoryController {
  constructor(private readonly service: ContactHistoryService) {}

  @Get(':contactId')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'The history of all of a client’s jobs, newest first',
    description:
      '**Guard:** `deals.view`. Every timeline entry of every job of the contact (GSI10 ContactActivityIndex), ' +
      'with the Workiz import’s client-level events (client created / deleted, no `dealId`) folded in by time. ' +
      'Each job event carries `dealId` and, when the job still resolves, `dealNumber`. ' +
      '`limit` 1–100 (default 30); a page may run a few rows past it where client-level events fall in. ' +
      'Page with `pagination.nextCursor`; the cursor is opaque.',
  })
  async list(
    @Param('contactId') contactId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.list(contactId, historyLimit(limit), cursor);
    return {
      success: true,
      data: page.items,
      pagination: { nextCursor: page.nextCursor, count: page.items.length },
    };
  }
}
