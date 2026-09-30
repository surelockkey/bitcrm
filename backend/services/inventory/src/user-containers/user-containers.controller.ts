import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { UserContainersService } from './user-containers.service';
import { AssignUserContainerDto } from './dto/assign-user-container.dto';

/**
 * Workiz "User containers". Assignments are container configuration, so they
 * ride on the `containers` permission rather than a resource of their own.
 */
@ApiTags('User containers')
@ApiBearerAuth()
@Controller('user-containers')
export class UserContainersController {
  constructor(private readonly service: UserContainersService) {}

  @Get()
  @RequirePermission('containers', 'view')
  @ApiOperation({
    summary: 'List every user container assignment',
    description:
      '**Guard:** `containers.view` permission required. One row per user that has one, in ' +
      'name order: `access` is `container` (with `containerId` / `containerName` / `limited`), ' +
      '`all` ("All locations") or `none` ("No access"). A user with no row has never been ' +
      'assigned — the web lists them from the users directory.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  // Before `:userId`, or the parameter route swallows it.
  @Get('me')
  @ApiOperation({
    summary: "The current user's container assignment",
    description: '**Guard:** Authenticated (any role). 404 when the caller has no assignment row.',
  })
  async mine(@CurrentUser() user: JwtUser) {
    const data = await this.service.mine(user);
    return { success: true, data };
  }

  @Get(':userId')
  @RequirePermission('containers', 'view')
  @ApiOperation({
    summary: "One user's container assignment",
    description: '**Guard:** `containers.view` permission required. 404 when the user has no row.',
  })
  async findByUser(@Param('userId') userId: string) {
    const data = await this.service.findByUser(userId);
    return { success: true, data };
  }

  @Put(':userId')
  @RequirePermission('containers', 'edit')
  @ApiOperation({
    summary: "Replace a user's container assignment",
    description:
      '**Guard:** `containers.edit` permission required. `access: container` needs a ' +
      '`containerId` that exists (404) and is active (400 "archived"); its name is ' +
      'snapshotted. `limited` is stored only with a container. A change of access or ' +
      'container is recorded in the inventory log as `container_assigned` (from the old ' +
      'container to the new one). Answers the stored row.',
  })
  async assign(
    @Param('userId') userId: string,
    @Body() dto: AssignUserContainerDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.assign(userId, dto, user);
    return { success: true, data };
  }
}

/**
 * `GET /containers/:id/users` lives here rather than on ContainersController,
 * so the containers module needs nothing from this one. Two segments, so no
 * `/containers/:id` route can shadow it.
 */
@ApiTags('Containers')
@ApiBearerAuth()
@Controller('containers')
export class ContainerUsersController {
  constructor(private readonly service: UserContainersService) {}

  @Get(':id/users')
  @RequirePermission('containers', 'view')
  @ApiOperation({
    summary: 'The users who work from a container',
    description:
      '**Guard:** `containers.view` permission required. The assignment rows whose one ' +
      'container is this one (`access: container`); 404 for an unknown container.',
  })
  async listUsers(@Param('id') id: string) {
    const data = await this.service.listByContainer(id);
    return { success: true, data };
  }
}
