import {
  Controller, Get, Post, Put, Delete, Body, Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { CustomFieldsService } from './custom-fields.service';
import { CreateCustomFieldDto } from './dto/create-custom-field.dto';
import { UpdateCustomFieldDto } from './dto/update-custom-field.dto';
import { Internal } from '../common/decorators/internal.decorator';

@ApiTags('Custom Fields')
@ApiBearerAuth()
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Post()
  @RequirePermission('custom_fields', 'create')
  @ApiOperation({
    summary: 'Create a custom field',
    description: '**Guard:** `custom_fields.create`. Rejected (409) if the name is already taken.',
  })
  async create(@Body() dto: CreateCustomFieldDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('custom_fields', 'view')
  @ApiOperation({
    summary: 'List all custom fields',
    description: '**Guard:** `custom_fields.view`. Includes archived fields; filter on `active` for forms.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: list custom fields for the search indexer',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const fields = await this.service.list();
    return {
      success: true,
      data: fields.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        searchable: f.searchable,
        options: f.options,
        jobTypeIds: f.jobTypeIds,
        active: f.active,
      })),
    };
  }

  @Get(':id')
  @RequirePermission('custom_fields', 'view')
  @ApiOperation({
    summary: 'Get a custom field by id',
    description: '**Guard:** `custom_fields.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('custom_fields', 'edit')
  @ApiOperation({
    summary: 'Update a custom field',
    description: '**Guard:** `custom_fields.edit`. Renaming re-checks name uniqueness (409).',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomFieldDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('custom_fields', 'delete')
  @ApiOperation({
    summary: 'Delete or archive a custom field',
    description:
      '**Guard:** `custom_fields.delete`. Fields still referenced by a deal are archived ' +
      '(`active: false`) instead of deleted, so historical deals keep resolving their answers. ' +
      'The response says which happened.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const { archived } = await this.service.remove(id, user);
    return { success: true, data: { id, archived, deleted: !archived } };
  }
}
