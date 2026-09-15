import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../api/access/resolved-permissions.decorator';
import { CreateGroupDto, GroupListQueryDto, UpdateGroupDto } from './dto/team.dto';
import { GroupsService } from './groups.service';

const MANAGE = '**Guard:** `team_chat.manage_groups` permission required; the `team_chat` data scope is enforced. ';

/**
 * Group chats (design §6): create, list, read, rename and change
 * membership. Messages go through `POST /conversations/:id/messages`
 * with `channel: in_app`.
 */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post()
  @RequirePermission('team_chat', 'manage_groups')
  @ApiOperation({
    summary: 'Create a group chat',
    description:
      MANAGE +
      '`{ name, memberIds }` — the caller joins as `owner`; every id is validated against user-service ' +
      '(400 names the unknown ones). Returns the conversation with its `members`.',
  })
  async create(@Body() dto: CreateGroupDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.groups.create(dto, user, perms) };
  }

  @Get()
  @RequirePermission('team_chat', 'view')
  @ApiOperation({
    summary: 'Groups the caller can see',
    description:
      '**Guard:** `team_chat.view` permission required. Every open group for the office, the caller’s ' +
      'own for `assigned_only`; newest activity first, cursor pagination, `viewerUnread` per row.',
  })
  async list(@Query() query: GroupListQueryDto, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    const result = await this.groups.list(query, user, perms);
    return {
      success: true,
      data: result.items,
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get(':id')
  @RequirePermission('team_chat', 'view')
  @ApiOperation({
    summary: 'One group with its roster',
    description: '**Guard:** `team_chat.view` permission required; data scope enforced. 404 when the id is not a group.',
  })
  async get(@Param('id') id: string, @CurrentUser() user: JwtUser, @ResolvedPerms() perms?: ResolvedPermissions) {
    return { success: true, data: await this.groups.get(id, user, perms) };
  }

  @Patch(':id')
  @RequirePermission('team_chat', 'manage_groups')
  @ApiOperation({
    summary: 'Rename a group, add or remove members',
    description:
      MANAGE +
      '`{ name?, addMemberIds?, removeMemberIds? }` — one transaction over the header and the `MEMBER#` ' +
      'rows; at least one member must remain; a lost optimistic-guard race after retries is a 409.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms?: ResolvedPermissions,
  ) {
    return { success: true, data: await this.groups.update(id, dto, user, perms) };
  }
}
