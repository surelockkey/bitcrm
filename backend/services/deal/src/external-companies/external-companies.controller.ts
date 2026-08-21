import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ExternalCompaniesService } from './external-companies.service';
import { CreateExternalCompanyDto } from './dto/create-external-company.dto';
import { UpdateExternalCompanyDto } from './dto/update-external-company.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('External Companies')
@ApiBearerAuth()
@Controller('external-companies')
export class ExternalCompaniesController {
  constructor(private readonly service: ExternalCompaniesService) {}

  @Post()
  @RequirePermission('external_companies', 'create')
  @ApiOperation({
    summary: 'Create an external company',
    description: '**Guard:** `external_companies.create`. Rejected (409) if the name is already taken.',
  })
  async create(@Body() dto: CreateExternalCompanyDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('external_companies', 'view')
  @ApiOperation({
    summary: 'List all external companies',
    description:
      '**Guard:** `external_companies.view`. Includes disabled companies; filter on `active` for pickers.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list external companies for the search indexer',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const companies = await this.service.list();
    return {
      success: true,
      data: companies.map((c) => ({ id: c.id, name: c.name, active: c.active })),
    };
  }

  @Get(':id')
  @RequirePermission('external_companies', 'view')
  @ApiOperation({
    summary: 'Get an external company by id',
    description: '**Guard:** `external_companies.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('external_companies', 'edit')
  @ApiOperation({
    summary: 'Update an external company',
    description:
      '**Guard:** `external_companies.edit`. Renaming re-checks name uniqueness (409). ' +
      'Set `active` to toggle Enabled/Disabled; an empty string clears a contact field.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateExternalCompanyDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('external_companies', 'delete')
  @ApiOperation({
    summary: 'Delete or disable an external company',
    description:
      '**Guard:** `external_companies.delete`. Companies still referenced by a job are ' +
      'disabled (`active: false`) instead of deleted, so historical jobs keep resolving ' +
      'their name. The response says which happened.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
