import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { CallGroupsService } from './call-groups.service';
import {
  CreateCallGroupDto,
  SetCallGroupMembersDto,
  UpdateCallGroupDto,
} from './dto/call-group.dto';

/**
 * Call groups are workspace telephony configuration, so they sit behind the
 * same `settings` permission as the phone numbers they will eventually be
 * attached to — one fewer role-matrix migration, and the two pages are edited
 * by the same person.
 */
@ApiTags('Call Groups')
@ApiBearerAuth()
@Controller('call-groups')
export class CallGroupsController {
  constructor(private readonly service: CallGroupsService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'List call groups',
    description:
      '**Guard:** `settings.view`. Each member comes back resolved — name, ' +
      'personal number and whether their softphone is registered right now — ' +
      'so the editor never re-derives who is reachable.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'Get one call group',
    description: '**Guard:** `settings.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Create a call group',
    description:
      '**Guard:** `settings.edit`. 409 if the name is taken; 400 for a member ' +
      'who is not an active user, a duplicate member, a personal channel for ' +
      'someone with no number on file, or an active group with nobody to ring.',
  })
  async create(@Body() dto: CreateCallGroupDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Update a call group’s name, type, ring time or paused state',
    description: '**Guard:** `settings.edit`. Membership has its own route.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCallGroupDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Put(':id/members')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Replace a call group’s membership',
    description:
      '**Guard:** `settings.edit`. The whole list is sent — adding, removing ' +
      'and reordering are one write, so a save can never leave half a team.',
  })
  async setMembers(
    @Param('id') id: string,
    @Body() dto: SetCallGroupMembersDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.setMembers(id, dto.members, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Delete a call group',
    description: '**Guard:** `settings.edit`.',
  })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { success: true, data: { id, deleted: true } };
  }
}
