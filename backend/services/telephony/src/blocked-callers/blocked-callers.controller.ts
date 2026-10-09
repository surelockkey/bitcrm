import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { Internal } from '../common/decorators/internal.decorator';
import { BlockedCallersService } from './blocked-callers.service';
import { BlockCallerDto } from './dto/block-caller.dto';

/**
 * Workiz Phone → "Blocked callers": numbers whose calls are rejected and
 * whose texts are dropped. All three routes sit behind `calls.block` — the
 * office blocks spam from the call log; a technician never sees the list.
 */
@ApiTags('Blocked Callers')
@ApiBearerAuth()
@Controller('blocked-callers')
export class BlockedCallersController {
  constructor(private readonly service: BlockedCallersService) {}

  @Get()
  @RequirePermission('calls', 'block')
  @ApiOperation({
    summary: 'List blocked callers',
    description:
      '**Guard:** `calls.block`. Oldest first. `q` matches the digits of a number or the words of a ' +
      'comment; `page` (1-based) and `limit` (default 50, at most 1000) page the list. ' +
      'Returns `{ data, pagination: { total, page, limit, pages } }`.',
  })
  async list(@Query('q') q?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const { data, pagination } = await this.service.list({ q, page, limit });
    return { success: true, data, pagination };
  }

  /**
   * What messaging reads on every inbound text (cached there). Ahead of the
   * `:number` route in the file for clarity; different verbs, so no shadowing.
   */
  @Get('internal/numbers')
  @Internal()
  @ApiOperation({
    summary: 'Every blocked number, E.164 (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). ' +
      'The list messaging drops inbound texts against.',
  })
  async internalNumbers() {
    const data = await this.service.numbers();
    return { success: true, data };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('calls', 'block')
  @ApiOperation({
    summary: 'Block a number',
    description:
      '**Guard:** `calls.block`. `number` in any dialable form (stored as E.164), optional `comment`. ' +
      '409 when the number is already blocked; 400 for an undialable number or a comment past 500 characters. ' +
      'From then on an inbound call from it gets `<Reject/>` and a log row with status `blocked`; an inbound ' +
      'text from it is dropped by messaging (within its 60 s cache).',
  })
  async block(@Body() dto: BlockCallerDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.block(dto, user);
    return { success: true, data };
  }

  @Delete(':number')
  @RequirePermission('calls', 'block')
  @ApiOperation({
    summary: 'Unblock a number',
    description:
      '**Guard:** `calls.block`. The number in any dialable form, URL-encoded (`%2B1…`). 404 when it is not blocked. ' +
      'The row is deleted — there is nothing to restore; block it again if needed.',
  })
  async unblock(@Param('number') number: string, @CurrentUser() user: JwtUser) {
    const data = await this.service.unblock(number, user);
    return { success: true, data };
  }
}
