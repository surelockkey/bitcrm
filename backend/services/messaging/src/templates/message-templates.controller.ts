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
import { CreateMessageTemplateDto } from './dto/create-message-template.dto';
import { UpdateMessageTemplateDto } from './dto/update-message-template.dto';
import { ListMessageTemplatesQueryDto } from './dto/list-message-templates-query.dto';

/**
 * `/api/messaging/templates` (design §7.1). Collection routes are declared
 * before `:id` routes — CLAUDE.md §4 on route shadowing.
 */
@ApiTags('Message Templates')
@ApiBearerAuth()
@Controller('templates')
export class MessageTemplatesController {
  constructor(private readonly service: MessageTemplatesService) {}

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

  @Get(':id')
  @RequirePermission('message_templates', 'view')
  @ApiOperation({ summary: 'Get a message template', description: '**Guard:** `message_templates.view`.' })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
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
