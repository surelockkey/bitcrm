import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { Internal } from '../access/internal.decorator';
import { ResolvedPerms } from '../access/resolved-permissions.decorator';
import { CountersService } from '../counters/counters.service';
import { ConversationsService } from './conversations.service';
import { InternalExportQueryDto } from './dto/internal-export-query.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { AddressQueryDto, TextLookupQueryDto } from './dto/lookup-query.dto';

/**
 * The inbox (design §7.1). Static routes (`counters`, `by-party`,
 * `by-address`, `by-job`, `text-lookup`, `internal/*`) are declared before
 * `:id` so they are not swallowed by it, and `internal/all` before
 * `internal/:id` for the same reason (CLAUDE.md §4).
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly counters: CountersService,
  ) {}

  @Get()
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'The inbox',
    description:
      '**Guard:** `messages.view` permission required; data scope enforced (`assigned_only` ' +
      'sees the threads of their own jobs and their own team thread). `view` picks the tab — ' +
      'all / unread / flagged / archived / mine; `kind` and `categoryId` narrow `view=all`. ' +
      'Newest activity first, cursor pagination. Client phone numbers are withheld without ' +
      '`contacts.view_numbers` (`phonesMasked`).',
  })
  async list(
    @Query() query: ListConversationsQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    const result = await this.conversations.list(query, user, perms);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('counters')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'Unread / flagged badge counters',
    description:
      '**Guard:** `messages.view` permission required. `{ unreadConversations, flaggedConversations, ' +
      'unreadByKind }` — company-wide for full scope, counted over their own threads for `assigned_only`.',
  })
  async getCounters(@CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.counters.get(user, perms) };
  }

  @Get('by-party/:kind/:id')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'The conversation of a contact, company, employee or group',
    description:
      '**Guard:** `messages.view` permission required; data scope enforced. Pointer lookup ' +
      '(`CONVOF#`), for the contact / company / employee cards. 404 until the first message.',
  })
  async byParty(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.conversations.getByParty(kind, id, user, perms) };
  }

  @Get('by-address')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'The conversation an E.164 number or email routes to',
    description:
      '**Guard:** `messages.view` permission required; data scope enforced. `ADDR#` pointer ' +
      'lookup — what an inbound message would land on. 404 when the address is unknown.',
  })
  async byAddress(
    @Query() query: AddressQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.conversations.getByAddress(query.address, user, perms) };
  }

  @Get('by-job/:dealId')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: "The job's client conversation",
    description:
      '**Guard:** `messages.view` permission required; under `assigned_only` the caller must be ' +
      "on the job. Resolves the job's contact (else company) to its thread. 404 when the job " +
      'has no conversation yet.',
  })
  async byJob(
    @Param('dealId') dealId: string,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.conversations.getByJob(dealId, user, perms) };
  }

  @Get('text-lookup')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'What the "Text" button needs',
    description:
      '**Guard:** `messages.view` permission required; data scope enforced. Give `partyKind` + ' +
      '`partyId` or an `address`: returns the existing conversation (or null), the address a ' +
      'message would go to (masked without `contacts.view_numbers`), its SMS opt-out row and `canText`.',
  })
  async textLookup(
    @Query() query: TextLookupQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.conversations.textLookup(query, user, perms) };
  }

  @Get('internal/all')
  @Internal()
  @ApiOperation({
    summary: 'Export every conversation (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). ' +
      'The search backfill walks this: open threads newest year first, then archived ones ' +
      '(InboxIndex year partitions, no Scan). Raw and unmasked; ' +
      '`{ items, nextCursor }` — repeat with `cursor` until `nextCursor` is absent.',
  })
  async listInternal(@Query() query: InternalExportQueryDto) {
    const page = await this.conversations.listInternal(query);
    return { success: true, data: { items: page.items, nextCursor: page.nextCursor } };
  }

  @Get('internal/:id')
  @Internal()
  @ApiOperation({
    summary: 'Get conversation by id (internal)',
    description:
      '**Guard:** Internal service-to-service only (`x-internal-secret` header required). ' +
      'Raw conversation for the search-service indexer (`conversation.updated`).',
  })
  async getInternal(@Param('id') id: string) {
    return { success: true, data: await this.conversations.getInternal(id) };
  }

  @Get(':id')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'A conversation and the caller\'s read marker',
    description:
      '**Guard:** `messages.view` permission required; data scope enforced (403 outside it). ' +
      'The conversation plus `readMarker` (`READ#<userId>`) when the caller has read it.',
  })
  async get(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.conversations.get(id, user, perms) };
  }
}
