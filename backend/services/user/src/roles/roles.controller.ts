import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { RESOURCE_REGISTRY } from '@bitcrm/types';
import { RolesService } from './roles.service';
import { UsersRepository } from '../users/users.repository';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly usersRepository: UsersRepository,
  ) {}

  @Post()
  @RequirePermission('roles', 'create')
  @ApiOperation({
    summary: 'Create a custom role with permission matrix',
    description:
      '**Guard:** `roles.create` permission required.\n\n' +
      'Creates a new custom role with a full permission matrix, data scope rules, and deal stage transitions. ' +
      'Role name must be unique. Cannot create system roles.',
  })
  async create(@Body() dto: CreateRoleDto) {
    const data = await this.rolesService.create(dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('roles', 'view')
  @ApiOperation({
    summary: 'List all roles',
    description: '**Guard:** `roles.view` permission required.\n\nReturns all roles including system defaults and custom roles.',
  })
  async findAll() {
    const data = await this.rolesService.findAll();
    return { success: true, data };
  }

  @Get('schema')
  @RequirePermission('roles', 'view')
  @ApiOperation({
    summary: 'Get permission matrix schema',
    description:
      '**Guard:** `roles.view` permission required.\n\n' +
      'Returns the resource registry — all available resources and their actions. ' +
      'Use this to render the permission matrix UI. When new resources are added to the system, they appear here automatically.',
  })
  async getSchema() {
    return {
      success: true,
      data: RESOURCE_REGISTRY,
    };
  }

  @Get(':id')
  @RequirePermission('roles', 'view')
  @ApiOperation({
    summary: 'Get role with full permission matrix',
    description: '**Guard:** `roles.view` permission required.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.rolesService.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('roles', 'edit')
  @ApiOperation({
    summary: 'Update role',
    description:
      '**Guard:** `roles.edit` permission required.\n\n' +
      'Partial updates supported — only include fields you want to change. ' +
      'Cannot edit the immutable Super Admin system role. ' +
      'When permissions/dataScope/transitions are updated, all users with this role have their permission cache invalidated.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const data = await this.rolesService.update(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('roles', 'delete')
  @ApiOperation({
    summary: 'Delete custom role',
    description:
      '**Guard:** `roles.delete` permission required.\n\n' +
      'Cannot delete system roles. Cannot delete a role that has users assigned — reassign users first (409 Conflict).',
  })
  async delete(@Param('id') id: string) {
    await this.rolesService.delete(id);
    return { success: true, data: null };
  }

  @Get(':id/users')
  @RequirePermission('roles', 'view')
  @ApiOperation({
    summary: 'List users assigned to this role',
    description: '**Guard:** `roles.view` permission required.',
  })
  async findUsersByRole(@Param('id') id: string) {
    await this.rolesService.findById(id);
    const data = await this.usersRepository.findByRoleId(id);
    return { success: true, data };
  }
}
