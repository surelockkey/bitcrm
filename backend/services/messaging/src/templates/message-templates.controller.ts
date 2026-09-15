import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { MessageTemplatesService } from './message-templates.service';
import { TemplateRenderer } from './template-renderer';
import { ContextLoader } from './context-loader';
import { SHORT_CODES } from './short-codes';
import { CreateMessageTemplateDto } from './dto/create-message-template.dto';
import { UpdateMessageTemplateDto } from './dto/update-message-template.dto';
import { ListMessageTemplatesQueryDto } from './dto/list-message-templates-query.dto';
import { PreviewTemplateDto, RenderTemplateDto } from './dto/render-template.dto';

/**
 * `/api/messaging/templates` (design §7.1). Collection routes are declared
 * before `:id` routes — CLAUDE.md §4 on route shadowing.
 */
@ApiTags('Message Templates')
@ApiBearerAuth()
@Controller('templates')
export class MessageTemplatesController {
  constructor(
    private readonly service: MessageTemplatesService,
    private readonly renderer: TemplateRenderer,
    private readonly contextLoader: ContextLoader,
  ) {}

  @Post()
  @RequirePermission('message_templates', 'create')
  @ApiOperation({
    summary: 'Create a message template',
    description:
      '**Guard:** `message_templates.create`. Body is HTML (Workiz shape) or plain text with ' +
      '`{{short_code}}` placeholders; an `sms` template must fit 1 600 characters once rendered to text (400).',
  })
  async create(@Body() dto: CreateMessageTemplateDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('message_templates', 'view')
  @ApiOperation({
    summary: 'List message templates, alphabetical by title',
    description:
      '**Guard:** `message_templates.view`. Active templates only unless `includeInactive=true`; ' +
      '`channel=sms|email` narrows to templates usable on that channel (`any` included).',
  })
  @ApiQuery({ name: 'channel', required: false, enum: ['sms', 'email'] })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  async list(@Query() query: ListMessageTemplatesQueryDto) {
    const data = await this.service.list(query);
    return { success: true, data };
  }

  @Get('short-codes')
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Short codes the composer and the template editor may insert',
    description:
      '**Guard:** `messages.send`. The Workiz-compatible standard codes (`{{first_name}}`, `{{job_date}}`, ' +
      '`{{confirm_link}}`, …) with a description each, followed by the active deal custom fields, which are ' +
      'inserted by name (`{{Manager Note}}`).',
  })
  async shortCodes() {
    const customFields = await this.contextLoader.listCustomFields();
    const data = [
      ...SHORT_CODES,
      ...customFields.map((f) => ({
        code: f.name,
        group: 'custom' as const,
        description: `Deal custom field "${f.name}"${f.type ? ` (${f.type})` : ''}`,
        example: '',
      })),
    ];
    return { success: true, data };
  }

  @Post('preview')
  @RequirePermission('message_templates', 'view')
  @ApiOperation({
    summary: 'Preview an unsaved template body',
    description:
      '**Guard:** `message_templates.view`. Renders `body` (and `subject`) against the ids and/or the inline ' +
      '`context`; unresolved codes stay visible unless `keepMissing: false`. Returns `{ body, subject?, missing }`.',
  })
  async previewBody(@Body() dto: PreviewTemplateDto, @CurrentUser() user: JwtUser) {
    const data = await this.preview(undefined, dto, user);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('message_templates', 'view')
  @ApiOperation({ summary: 'Get a message template', description: '**Guard:** `message_templates.view`.' })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Post(':id/render')
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Render a template for a conversation / contact / job',
    description:
      '**Guard:** `messages.send`. `{ conversationId?, contactId?, dealId?, values? }` → `{ body, subject?, missing }` ' +
      'with every short code substituted; `missing` lists the codes that had no value (rendered empty). ' +
      'SMS templates come back as plain text, email templates as HTML.',
  })
  async render(@Param('id') id: string, @Body() dto: RenderTemplateDto, @CurrentUser() user: JwtUser) {
    const data = await this.renderer.render(
      { templateId: id },
      { conversationId: dto.conversationId, contactId: dto.contactId, dealId: dto.dealId, userId: user.id, values: dto.values },
    );
    return { success: true, data };
  }

  @Post(':id/preview')
  @RequirePermission('message_templates', 'view')
  @ApiOperation({
    summary: 'Preview a stored template with a context',
    description:
      '**Guard:** `message_templates.view`. Like `render`, plus an optional unsaved `body`, an inline sample ' +
      '`context` merged over the loaded one, `format`, and `keepMissing` (default true).',
  })
  async previewStored(@Param('id') id: string, @Body() dto: PreviewTemplateDto, @CurrentUser() user: JwtUser) {
    const data = await this.preview(id, dto, user);
    return { success: true, data };
  }

  private async preview(templateId: string | undefined, dto: PreviewTemplateDto, user: JwtUser) {
    const template = templateId ? await this.service.findById(templateId) : undefined;
    const loaded = await this.contextLoader.load({
      conversationId: dto.conversationId,
      contactId: dto.contactId,
      dealId: dto.dealId,
      userId: user.id,
      values: dto.values,
    });
    const ctx = { ...loaded, ...(dto.context ?? {}), values: { ...loaded.values, ...dto.context?.values, ...dto.values } };
    return this.renderer.renderWithContext(
      {
        body: dto.body ?? template?.messageTemplate ?? '',
        subject: dto.subject ?? template?.messageSubjectTemplate,
        format: dto.format ?? (template?.channel === 'email' ? 'html' : 'text'),
        keepMissing: dto.keepMissing ?? true,
      },
      ctx,
    );
  }

  @Put(':id')
  @RequirePermission('message_templates', 'edit')
  @ApiOperation({
    summary: 'Update a message template',
    description:
      '**Guard:** `message_templates.edit`. Partial body; `active: true` restores an archived template.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMessageTemplateDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('message_templates', 'delete')
  @ApiOperation({
    summary: 'Archive a message template (or delete an archived one permanently)',
    description:
      '**Guard:** `message_templates.delete`. Archives (`active: false`) so history keeps resolving the ' +
      'title. `?permanent=true` removes the row, and only when it is already archived (409 otherwise).',
  })
  @ApiQuery({ name: 'permanent', required: false, type: Boolean })
  async remove(
    @Param('id') id: string,
    @Query('permanent') permanent: string | boolean | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    if (permanent === true || permanent === 'true') {
      await this.service.remove(id, user);
      return { success: true, data: { id, archived: false, deleted: true } };
    }
    await this.service.archive(id, user);
    return { success: true, data: { id, archived: true, deleted: false } };
  }
}
