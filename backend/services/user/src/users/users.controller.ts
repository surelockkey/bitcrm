import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, RequirePermission, Public } from "@bitcrm/shared";
import { type JwtUser } from "@bitcrm/types";
import { UsersService } from "./users.service";
import { Internal } from "../common/decorators/internal.decorator";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { AssignRoleDto } from "./dto/assign-role.dto";
import { SetPermissionOverridesDto } from "./dto/set-permission-overrides.dto";

@ApiTags("Users")
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  @ApiOperation({
    summary: "Get current user profile",
    description: "**Guard:** Authenticated (any role). Returns the profile of the currently logged-in user.",
  })
  async getMe(@CurrentUser() user: JwtUser) {
    const data = await this.usersService.findCurrentUser(user);
    return { success: true, data };
  }

  @Post()
  @RequirePermission("users", "create")
  @ApiOperation({
    summary: "Create a new user",
    description: "**Guard:** `users.create` permission required.",
  })
  async create(@Body() dto: CreateUserDto, @CurrentUser() user: JwtUser) {
    const data = await this.usersService.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission("users", "view")
  @ApiOperation({
    summary: "List users with filters",
    description: "**Guard:** `users.view` permission required.",
  })
  async list(@Query() query: ListUsersQueryDto) {
    return this.usersService.list(query);
  }

  @Get("internal/permissions/:userId")
  @Public()
  @ApiOperation({
    summary: "Resolve permissions for user (internal)",
    description: "**Guard:** Public (no auth). Internal service-to-service endpoint for permission resolution on cache miss.",
  })
  async resolvePermissions(@Param("userId") userId: string) {
    return this.usersService.getResolvedPermissions(userId);
  }

  // Declared before `:id` — otherwise Nest matches "internal" as a user id.
  @Get("internal/technicians/assignable")
  @Internal()
  @ApiOperation({
    summary: "Internal: assignable technicians for dispatch",
    description:
      "**Guard:** Internal only (`x-internal-secret` required). Every technician holding an " +
      "approved job type AND service area, with their approved catalog ids and home coordinates. " +
      "deal-service projects this into its eligibility read-model, which backs " +
      "`GET /deals/:id/qualified-techs`. Matching happens there, by id — hence no filter params.",
  })
  async listAssignableTechnicians() {
    const data = await this.usersService.listAssignableTechnicians();
    return { success: true, data };
  }

  // Declared before `:id` — otherwise Nest matches "internal" as a user id.
  @Get("internal/technicians/:technicianId/eligibility")
  @Internal()
  @ApiOperation({
    summary: "Internal: one technician's assignment eligibility",
    description:
      "**Guard:** Internal only (`x-internal-secret` required). Read by deal-service when a " +
      "`tech.approved` / `tech.updated` event arrives, to refresh that technician's projection.",
  })
  async getTechnicianEligibility(@Param("technicianId") technicianId: string) {
    const data = await this.usersService.getTechnicianEligibility(technicianId);
    return { success: true, data };
  }

  // Declared before `:id` — otherwise Nest matches "internal" as a user id.
  @Get("internal/all")
  @Internal()
  @ApiOperation({
    summary: "Internal: list all users (paginated)",
    description:
      "**Guard:** Internal only (`x-internal-secret` required). Unfiltered, cursor-paginated " +
      "listing of every user. Powers the search-service backfill/indexer. `limit` defaults to 200 " +
      "and is clamped to a maximum of 500.",
  })
  async internalListAll(
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    // No transforming ValidationPipe on this service — query params arrive as strings.
    const parsed = Number.parseInt(limit ?? "", 10);
    const safeLimit = Math.min(
      Number.isFinite(parsed) && parsed > 0 ? parsed : 200,
      500,
    );
    const data = await this.usersService.findAll(safeLimit, cursor);
    return { success: true, data };
  }

  // Catch-all internal param — MUST stay after every static `internal/*` route.
  @Get("internal/:id")
  @Internal()
  @ApiOperation({
    summary: "Internal: get user by ID",
    description:
      "**Guard:** Internal only (`x-internal-secret` required). Fetches a single user by id for " +
      "the search-service indexer. Returns 404 if the user does not exist.",
  })
  async internalFindById(@Param("id") id: string) {
    const data = await this.usersService.findById(id);
    if (!data) throw new NotFoundException("User not found");
    return { success: true, data };
  }

  @Get(":id")
  @RequirePermission("users", "view")
  @ApiOperation({
    summary: "Get user by ID",
    description: "**Guard:** `users.view` permission required.",
  })
  async findById(@Param("id") id: string) {
    const data = await this.usersService.findById(id);
    return { success: true, data };
  }

  @Put(":id")
  @RequirePermission("users", "edit")
  @ApiOperation({
    summary: "Update user profile fields",
    description: "**Guard:** `users.edit` permission required. Caller must have higher role priority than the target user.",
  })
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.usersService.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(":id")
  @RequirePermission("users", "delete")
  @ApiOperation({
    summary: "Deactivate user",
    description: "**Guard:** `users.delete` permission required. Caller must have higher role priority than the target user. Cannot deactivate yourself.",
  })
  async deactivate(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    await this.usersService.deactivate(id, user);
    return { success: true, data: null };
  }

  @Post(":id/invite")
  @RequirePermission("users", "create")
  @ApiOperation({
    summary: "Resend the email invitation",
    description:
      "**Guard:** `users.create` permission required (Admin+). " +
      "Re-sends the Cognito invitation email to a user who hasn't accepted yet.",
  })
  async resendInvite(@Param("id") id: string) {
    await this.usersService.resendInvite(id);
    return { success: true, data: null };
  }

  @Post(":id/reactivate")
  @RequirePermission("users", "edit")
  @ApiOperation({
    summary: "Reactivate deactivated user",
    description: "**Guard:** `users.edit` permission required. Caller must have higher role priority than the target user.",
  })
  async reactivate(@Param("id") id: string, @CurrentUser() user: JwtUser) {
    await this.usersService.reactivate(id, user);
    return { success: true, data: null };
  }

  @Put(":id/role")
  @RequirePermission("users", "edit")
  @ApiOperation({
    summary: "Assign a role to user",
    description:
      "**Guard:** `users.edit` permission required. " +
      "Caller must have higher role priority than both the target user's current role and the new role. " +
      "Super Admins can manage other Super Admins. " +
      "Clears any per-user permission overrides on the target user. " +
      "Cannot change your own role. Cannot remove the last Super Admin.",
  })
  async assignRole(
    @Param("id") id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.usersService.assignRole(id, dto.roleId, user);
    return { success: true, data };
  }

  @Put(":id/permissions")
  @RequirePermission("users", "edit")
  @ApiOperation({
    summary: "Set per-user permission overrides",
    description:
      "**Guard:** `users.edit` permission required. Caller must have higher role priority than the target user.\n\n" +
      "Sparse overrides — only include fields that differ from the role base. " +
      "These overrides are merged with the role permissions at runtime (user wins on conflict). " +
      "Use `DELETE /:id/permissions` to clear all overrides.",
  })
  async setPermissionOverrides(
    @Param("id") id: string,
    @Body() dto: SetPermissionOverridesDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.usersService.setPermissionOverrides(id, dto, user);
    return { success: true, data };
  }

  @Get(":id/permissions")
  @RequirePermission("users", "view")
  @ApiOperation({
    summary: "Get resolved permissions for user",
    description:
      "**Guard:** `users.view` permission required.\n\n" +
      "Returns the fully merged permission matrix: role base + per-user overrides. " +
      "Includes permissions, dataScope, dealStageTransitions, and whether overrides exist.",
  })
  async getResolvedPermissions(@Param("id") id: string) {
    const data = await this.usersService.getResolvedPermissions(id);
    return { success: true, data };
  }

  @Delete(":id/permissions")
  @RequirePermission("users", "edit")
  @ApiOperation({
    summary: "Clear per-user permission overrides",
    description:
      "**Guard:** `users.edit` permission required. Caller must have higher role priority than the target user.\n\n" +
      "Removes all per-user overrides. User reverts to pure role-based permissions.",
  })
  async clearPermissionOverrides(
    @Param("id") id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.usersService.clearPermissionOverrides(id, user);
    return { success: true, data };
  }
}
