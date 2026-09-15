import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../access/resolved-permissions.decorator';
import { UpdateMessageDto } from '../messages/dto/update-message.dto';
import { ConversationManagementService } from './conversation-management.service';
import { AssignConversationDto, MarkReadDto, UpdateConversationDto } from './dto/update-conversation.dto';

const MANAGE = '**Guard:** `messages.manage` permission required; data scope enforced (403 outside it). ';

/**
 * State changes on a conversation (design §7.1). Every route answers with
 * the conversation as written (masked per `contacts.view_numbers`); a lost
 * optimistic-guard race after retries is a 409.
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationManagementController {
  constructor(private readonly management: ConversationManagementService) {}

  @Patch(':id')
  @RequirePermission('messages', 'manage')
  @ApiOperation({
    summary: 'Archive / restore, flag, mark unread, recategorise, assign',
    description:
      MANAGE +
      '`{ state?, flagged?, unread?, categoryId?, assignedUserId? }`; `null` clears categoryId / ' +
      'assignedUserId. The unread / flagged badge counters move in the same transaction.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.management.update(id, dto, user, perms) };
  }

  @Post(':id/read')
  @RequirePermission('messages', 'view')
  @ApiOperation({
    summary: 'Mark the conversation read',
    description:
      '**Guard:** `messages.view` permission required; data scope enforced. Writes the caller\'s ' +
      '`READ#` marker (`lastReadMessageSk`), clears the team `unread` flag and decrements the ' +
      'unread counters in one transaction.',
  })
  async markRead(
    @Param('id') id: string,
    @Body() dto: MarkReadDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.management.markRead(id, dto?.lastReadMessageSk, user, perms) };
  }

  @Post(':id/archive')
  @RequirePermission('messages', 'manage')
  @ApiOperation({ summary: 'Archive the conversation', description: MANAGE + 'Leaves the open inbox (GSI1 `INBOX#archived#`), keeps the history.' })
  async archive(@Param('id') id: string, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.management.archive(id, user, perms) };
  }

  @Post(':id/unarchive')
  @RequirePermission('messages', 'manage')
  @ApiOperation({ summary: 'Restore an archived conversation', description: MANAGE + 'Back to the open inbox.' })
  async unarchive(@Param('id') id: string, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.management.unarchive(id, user, perms) };
  }

  @Post(':id/flag')
  @RequirePermission('messages', 'manage')
  @ApiOperation({ summary: 'Flag the conversation', description: MANAGE + 'Joins the Flagged tab (GSI5 `FLAG#conversation`).' })
  async flag(@Param('id') id: string, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.management.flag(id, user, perms) };
  }

  @Delete(':id/flag')
  @RequirePermission('messages', 'manage')
  @ApiOperation({ summary: 'Unflag the conversation', description: MANAGE })
  async unflag(@Param('id') id: string, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.management.unflag(id, user, perms) };
  }

  @Post(':id/assign')
  @RequirePermission('messages', 'manage')
  @ApiOperation({
    summary: 'Assign the conversation to a teammate',
    description: MANAGE + '`{ userId }` — validated against user-service (404 when unknown, 503 when it cannot answer).',
  })
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignConversationDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.management.assign(id, dto.userId, user, perms) };
  }

  @Delete(':id/assign')
  @RequirePermission('messages', 'manage')
  @ApiOperation({ summary: 'Unassign the conversation', description: MANAGE })
  async unassign(@Param('id') id: string, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.management.unassign(id, user, perms) };
  }

  @Patch(':id/messages/:messageId')
  @RequirePermission('messages', 'manage')
  @ApiOperation({
    summary: 'Flag or unflag one message',
    description:
      MANAGE +
      '`{ createdAt, flagged }` — `createdAt` is part of the message sort key. Returns the message as written.',
  })
  async setMessageFlag(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return {
      success: true,
      data: await this.management.setMessageFlag(id, messageId, dto.createdAt, dto.flagged, user, perms),
    };
  }
}
