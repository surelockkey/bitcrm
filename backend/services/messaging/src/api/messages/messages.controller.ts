import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { Internal } from '../access/internal.decorator';
import { ResolvedPerms } from '../access/resolved-permissions.decorator';
import { PagingQueryDto } from '../conversations/dto/paging-query.dto';
import { MessagesService } from './messages.service';

/**
 * The feeds (design §7.1): newest first, `cursor` = "load older". The
 * internal route is declared first so `conversations/internal/…` is never
 * read as a conversation id (CLAUDE.md §4).
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('conversations/internal/:id/messages')
  @Internal()
  @ApiOperation({
    summary: 'The latest messages of a conversation (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). ' +
      'Raw, unmasked, newest first — what the search indexer folds into the conversation ' +
      'document (design §7.4). `limit` caps the page; `cursor` loads older.',
  })
  async internalByConversation(@Param('id') id: string, @Query() query: PagingQueryDto) {
    const result = await this.messages.listInternal(id, query);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('conversations/:id/messages')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'The conversation feed',
    description:
      '**Guard:** `messages.view` permission required; data scope enforced on the conversation. ' +
      'Newest first; `cursor` loads older. Client phone numbers are withheld without ' +
      '`contacts.view_numbers` (`fromMasked` / `toMasked`).',
  })
  async byConversation(
    @Param('id') id: string,
    @Query() query: PagingQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    const result = await this.messages.listByConversation(id, query, user, perms);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('messages/flagged')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'Flagged messages',
    description:
      '**Guard:** `messages.view` permission required. Company-wide flagged messages, newest ' +
      'first (FlagIndex); an `assigned_only` caller sees only those in their threads.',
  })
  async flagged(
    @Query() query: PagingQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    const result = await this.messages.listFlagged(query, user, perms);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('messages/by-job/:dealId')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: "A job's messages",
    description:
      '**Guard:** `messages.view` permission required; under `assigned_only` the caller must be ' +
      'on the job. Every message that referenced the job (JobIndex), newest first — the ' +
      '"Messages" tab of the job page.',
  })
  async byJob(
    @Param('dealId') dealId: string,
    @Query() query: PagingQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    const result = await this.messages.listByJob(dealId, query, user, perms);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }
}
