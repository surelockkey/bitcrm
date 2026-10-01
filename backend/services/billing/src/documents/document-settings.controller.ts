import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { DocumentSettingsService } from './document-settings.service';
import { UpdateDocumentSettingsDto } from './dto/document-settings.dto';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('document-settings')
export class DocumentSettingsController {
  constructor(private readonly settings: DocumentSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Account document defaults',
    description:
      '**Guard:** any authenticated user (the estimate/invoice editors and the Send panel need them). ' +
      'Default notes, the default estimate deposit and the invoice "Request signature" default.',
  })
  async get() {
    return { success: true, data: await this.settings.get() };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Update account document defaults',
    description:
      '**Guard:** `settings.edit`. Partial: only the fields sent change. The default deposit is a ' +
      'percent OR an amount; `null` clears it.',
  })
  async update(@Body() dto: UpdateDocumentSettingsDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.settings.update(dto, user.id) };
  }
}
