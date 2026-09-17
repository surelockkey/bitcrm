import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { TemplatesService } from './templates.service';

@ApiTags('Document templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermission('document_templates', 'view')
  @ApiOperation({
    summary: 'List templates',
    description: '**Guard:** `document_templates.view`. Seeds the default invoice/estimate templates on first read.',
  })
  async list() {
    return { success: true, data: await this.templates.list() };
  }

  @Get('presets')
  @RequirePermission('document_templates', 'view')
  @ApiOperation({ summary: 'Starting presets', description: '**Guard:** `document_templates.view`.' })
  presets() {
    return { success: true, data: this.templates.presets() };
  }

  @Get(':id')
  @RequirePermission('document_templates', 'view')
  @ApiOperation({ summary: 'Get template', description: '**Guard:** `document_templates.view`.' })
  async get(@Param('id') id: string) {
    return { success: true, data: await this.templates.get(id) };
  }

  @Post()
  @RequirePermission('document_templates', 'edit')
  @ApiOperation({ summary: 'Create template', description: '**Guard:** `document_templates.edit`. From a preset or a copy of `fromTemplateId`.' })
  async create(@Body() dto: CreateTemplateDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.templates.create(dto, user) };
  }

  @Put(':id')
  @RequirePermission('document_templates', 'edit')
  @ApiOperation({
    summary: 'Save template',
    description: '**Guard:** `document_templates.edit`. Optimistic: `version` must be the loaded one (409 otherwise); 400 with `errors` for invalid content.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateTemplateDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.templates.update(id, dto, user) };
  }

  @Post(':id/duplicate')
  @RequirePermission('document_templates', 'edit')
  @ApiOperation({ summary: 'Duplicate template', description: '**Guard:** `document_templates.edit`.' })
  async duplicate(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.templates.duplicate(id, user) };
  }

  @Post(':id/default')
  @RequirePermission('document_templates', 'edit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Make default for its kind', description: '**Guard:** `document_templates.edit`.' })
  async setDefault(@Param('id') id: string) {
    return { success: true, data: await this.templates.setDefault(id) };
  }

  @Delete(':id')
  @RequirePermission('document_templates', 'edit')
  @ApiOperation({ summary: 'Delete template', description: '**Guard:** `document_templates.edit`. 409 for a default template.' })
  async delete(@Param('id') id: string) {
    await this.templates.delete(id);
    return { success: true, data: { deleted: true } };
  }
}
