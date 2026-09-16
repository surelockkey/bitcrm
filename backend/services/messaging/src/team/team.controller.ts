import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { MarkReadDto } from '../api/conversations/dto/update-conversation.dto';
import { ResolvedPerms } from '../api/access/resolved-permissions.decorator';
import { TeamListQueryDto } from './dto/team.dto';
import { TeamConversationsService } from './team-conversations.service';

const VIEW =
  '**Guard:** `team_chat.view` permission required; the `team_chat` data scope is enforced ' +
  '(`all` sees every employee thread and group, `assigned_only` their own thread and groups). ';

/**
 * Staff chat (design §6, §7.1): employee threads and groups as one viewer
 * sees them. Feeds and sending stay on the inbox routes
 * (`GET/POST /conversations/:id/messages`); what lives here is the
 * per-member view — list, badge, read state, participants. Static routes
 * (`counters`) are declared before `conversations/:id` (CLAUDE.md §4).
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamConversationsService) {}

  @Get('conversations')
  @RequirePermission('team_chat', 'view')
  @ApiOperation({
    summary: 'Employee threads or groups, with the caller’s read state',
    description:
      VIEW +
      '`kind=team` (default) lists employee 1:1 threads, `kind=group` the groups; newest activity ' +
      'first, cursor pagination. Every row carries `viewerUnread` / `viewerUnreadCount` computed ' +
      "from the caller's own `READ#` marker.",
  })
  async list(
    @Query() query: TeamListQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    const result = await this.team.list(query, user, perms);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('counters')
  @RequirePermission('team_chat', 'view')
  @ApiOperation({
    summary: 'The caller’s team-chat badge',
    description:
      '**Guard:** `team_chat.view` permission required. `{ unreadConversations, unreadByKind: { team, group } }` ' +
      "over the caller's own thread and groups, against their `READ#` markers. The office's Team-tab badge " +
      'stays `GET /conversations/counters` (`unreadByKind.team`).',
  })
  async counters(@CurrentUser() user: JwtUser) {
    return { success: true, data: await this.team.counters(user) };
  }

  @Get('conversations/:id')
  @RequirePermission('team_chat', 'view')
  @ApiOperation({
    summary: 'One staff thread with the caller’s read state (and the roster of a group)',
    description: VIEW + '404 for a client thread. A group also returns `members` with their read markers.',
  })
  async get(@Param('id') id: string, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.team.get(id, user, perms) };
  }

  @Get('conversations/:id/participants')
  @RequirePermission('team_chat', 'view')
  @ApiOperation({
    summary: 'Who is in the thread and who has read it',
    description:
      VIEW +
      '`members` — the group roster (the employee, for a 1:1 thread) with `lastReadAt` / ' +
      '`lastReadMessageSk`; `readers` — every `READ#` marker (the office side of a 1:1 thread).',
  })
  async participants(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.team.getParticipants(id, user, perms) };
  }

  @Post('conversations/:id/read')
  @RequirePermission('team_chat', 'view')
  @ApiOperation({
    summary: 'Mark a staff thread read for the caller',
    description:
      VIEW +
      "`{ lastReadMessageSk? }` → the caller's `READ#` marker. On an employee's thread the office " +
      '(full scope, not the employee) also clears the team-wide `unread` and moves the inbox counters; ' +
      'the employee and group members only move their own marker.',
  })
  async markRead(
    @Param('id') id: string,
    @Body() dto: MarkReadDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.team.markRead(id, dto?.lastReadMessageSk, user, perms) };
  }
}
