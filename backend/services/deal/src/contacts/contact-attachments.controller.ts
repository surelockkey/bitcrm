import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ContactAttachmentsService } from './contact-attachments.service';
import { UploadAttachmentDto } from '../deals/attachments/dto/upload-attachment.dto';
import { UpdateAttachmentDto } from '../deals/attachments/dto/update-attachment.dto';
import { historyLimit } from './contact-history.controller';

/**
 * The client card's Files. Registered ahead of DealsController so
 * `GET /:id/attachments` never takes `/attachments/by-contact/…`.
 */
@ApiTags('Contact History & Files')
@ApiBearerAuth()
@Controller()
export class ContactAttachmentsController {
  constructor(private readonly service: ContactAttachmentsService) {}

  @Get('attachments/by-contact/:contactId')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Every file of a client — its jobs’ and its own — newest first',
    description:
      '**Guard:** `deals.view`. Rows off GSI10 ContactActivityIndex. A row with `dealId` is a job’s file: download it ' +
      'through `GET /deals/:dealId/attachments/:id` and show "Job: <dealNumber>". A row without `dealId` is the client’s ' +
      'own file: `GET /deals/contacts/:contactId/attachments/:id`. `limit` 1–100 (default 30), `pagination.nextCursor` is opaque.',
  })
  async listByContact(
    @Param('contactId') contactId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const page = await this.service.listByContact(contactId, historyLimit(limit), cursor);
    return {
      success: true,
      data: page.items,
      pagination: { nextCursor: page.nextCursor, count: page.items.length },
    };
  }

  @Post('contacts/:contactId/attachments')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({
    summary: 'Request a presigned (SSE-KMS) upload URL for a file on the client itself',
    description:
      '**Guard:** `contacts.edit`. Same body and flow as a job attachment; the returned headers must be replayed on the PUT. ' +
      'Object key `contacts/<contactId>/attachments/<id>`.',
  })
  async requestUpload(
    @Param('contactId') contactId: string,
    @Body() dto: UploadAttachmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.requestUpload(contactId, dto, user);
    return { success: true, data };
  }

  @Get('contacts/:contactId/attachments/:attachmentId')
  @RequirePermission('contacts', 'view')
  @ApiOperation({ summary: 'Short-TTL presigned download URL of a client’s own file', description: '**Guard:** `contacts.view`.' })
  async download(@Param('contactId') contactId: string, @Param('attachmentId') attachmentId: string) {
    const data = await this.service.getDownloadUrl(contactId, attachmentId);
    return { success: true, data };
  }

  @Patch('contacts/:contactId/attachments/:attachmentId')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({ summary: 'Rename a client’s own file / edit its description', description: '**Guard:** `contacts.edit`.' })
  async update(
    @Param('contactId') contactId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: UpdateAttachmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(contactId, attachmentId, dto, user);
    return { success: true, data };
  }

  @Delete('contacts/:contactId/attachments/:attachmentId')
  @RequirePermission('contacts', 'edit')
  @ApiOperation({ summary: 'Delete a client’s own file', description: '**Guard:** `contacts.edit`.' })
  async remove(
    @Param('contactId') contactId: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this.service.delete(contactId, attachmentId, user);
    return { success: true, data: null };
  }
}
