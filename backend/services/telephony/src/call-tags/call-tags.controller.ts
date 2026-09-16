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
import { CallTagsService } from './call-tags.service';
import { CreateCallTagDto, UpdateCallTagDto } from './dto/call-tag.dto';

/**
 * Call tags are workspace telephony configuration, so — like call groups and
 * call flows — they sit behind the `settings` permission. Putting a tag ON a
 * call is a call-log action and lives on `PATCH /calls/:sid/tags` under
 * `calls.view`.
 */
@ApiTags('Call Tags')
@ApiBearerAuth()
@Controller('call-tags')
export class CallTagsController {
  constructor(private readonly service: CallTagsService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'List call tags',
    description:
      '**Guard:** `settings.view`. Archived tags included (so the log can ' +
      'still name them) — pickers filter on `active`. Priority-first, then ' +
      'by name.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'Get one call tag',
    description: '**Guard:** `settings.view`.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Create a call tag',
    description:
      '**Guard:** `settings.edit`. 409 if the name is taken (case-insensitive); ' +
      '400 for an empty name or a color outside the palette.',
  })
  async create(@Body() dto: CreateCallTagDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    return { success: true, data };
  }

  @Put(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Rename, recolor, reprioritise, archive or restore a call tag',
    description:
      '**Guard:** `settings.edit`. Renaming re-checks uniqueness (409). ' +
      '`active: false` archives, `active: true` restores.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCallTagDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, dto, user);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Archive a call tag',
    description:
      '**Guard:** `settings.edit`. Always an archive (`active: false`), never ' +
      'a delete: calls keep their `tagIds` and the label keeps resolving on ' +
      'historical rows. Idempotent.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const tag = await this.service.archive(id, user);
    return { success: true, data: { id: tag.id, archived: true, deleted: false } };
  }
}
