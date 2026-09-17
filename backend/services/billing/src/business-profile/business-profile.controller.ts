import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { Internal } from '../common/decorators/internal.decorator';
import { BusinessProfileService } from './business-profile.service';
import {
  CreateBusinessProfileDto,
  PatchBusinessProfileDto,
  UpdateBusinessProfileDto,
} from './dto/update-business-profile.dto';

/**
 * Companies (business profiles). Read = any authenticated user; write =
 * `settings.edit`. `GET internal` is declared before `GET :id` so it is not
 * captured as an id.
 */
@ApiTags('Companies (business profiles)')
@ApiBearerAuth()
@Controller('business-profiles')
export class BusinessProfilesController {
  constructor(private readonly profiles: BusinessProfileService) {}

  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, enum: ['true', 'false'] })
  @ApiOperation({
    summary: 'List companies',
    description:
      '**Guard:** any authenticated user. Default first, then by name; archived only with ' +
      '`?includeInactive=true`. Each has a short-lived `logoUrl`. Lazily migrates the legacy singleton.',
  })
  async list(@Query('includeInactive') includeInactive?: string) {
    return { success: true, data: await this.profiles.list({ includeInactive: includeInactive === 'true' }) };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: every company (archived included)',
    description: '**Guard:** internal secret (`x-internal-secret`). Read by deal-service to validate/snapshot job companies.',
  })
  async listInternal() {
    return { success: true, data: await this.profiles.listAll() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a company', description: '**Guard:** any authenticated user.' })
  async get(@Param('id') id: string) {
    return { success: true, data: await this.profiles.getView(id) };
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Create a company',
    description: '**Guard:** `settings.edit`. The first company becomes the default. 422 when the logo upload did not finish.',
  })
  async create(@Body() dto: CreateBusinessProfileDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.profiles.create(dto, user.id) };
  }

  @Put(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Update a company (partial)',
    description:
      '**Guard:** `settings.edit`. `null` clears an optional field (incl. `logoAssetId`). The default ' +
      'company cannot be archived. 422 when a new logo upload did not finish.',
  })
  async update(@Param('id') id: string, @Body() dto: PatchBusinessProfileDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.profiles.update(id, dto, user.id) };
  }

  @Post(':id/default')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Make a company the default',
    description: '**Guard:** `settings.edit`. Must be active; every other company stops being the default (one transaction).',
  })
  async setDefault(@Param('id') id: string) {
    return { success: true, data: await this.profiles.setDefault(id) };
  }

  @Delete(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Delete a company',
    description:
      '**Guard:** `settings.edit`. 409 for the default company or while a template auto-applies to it. ' +
      'Jobs keep their snapshotted company name.',
  })
  async remove(@Param('id') id: string) {
    await this.profiles.remove(id);
    return { success: true, data: { id, deleted: true } };
  }
}

/** Compatibility singleton: the default company. */
@ApiTags('Companies (business profiles)')
@ApiBearerAuth()
@Controller('business-profile')
export class BusinessProfileController {
  constructor(private readonly profiles: BusinessProfileService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the default company (compat)',
    description: '**Guard:** any authenticated user. Includes a short-lived `logoUrl`. Prefer `GET /business-profiles`.',
  })
  async get() {
    return { success: true, data: await this.profiles.getWithLogo() };
  }

  @Put()
  @RequirePermission('document_templates', 'edit')
  @ApiOperation({
    summary: 'Save the default company (compat)',
    description: '**Guard:** `document_templates.edit`. Prefer `PUT /business-profiles/:id`.',
  })
  async update(@Body() dto: UpdateBusinessProfileDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.profiles.updateDefault(dto, user.id) };
  }
}
