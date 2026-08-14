import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { DealAttachmentsService } from './deal-attachments.service';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { UpdateAttachmentDto } from './dto/update-attachment.dto';

/** Photos and files attached to a job. Gated by the `deals` permission. */
@ApiTags('Deal Attachments')
@ApiBearerAuth()
@Controller()
export class DealAttachmentsController {
  constructor(private readonly service: DealAttachmentsService) {}

  @Post(':id/attachments')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Request a presigned (SSE-KMS) upload URL for a job attachment',
    description: '**Guard:** `deals.edit`. The returned headers must be replayed on the PUT.',
  })
  async requestUpload(
    @Param('id') id: string,
    @Body() dto: UploadAttachmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.requestUpload(id, dto, user);
    return { success: true, data };
  }

  @Get(':id/attachments')
  @RequirePermission('deals', 'view')
  @ApiOperation({ summary: 'List a job’s attachments (metadata)', description: '**Guard:** `deals.view`.' })
  async list(@Param('id') id: string) {
    const data = await this.service.list(id);
    return { success: true, data };
  }

  @Get(':id/attachments/:attachmentId')
  @RequirePermission('deals', 'view')
  @ApiOperation({ summary: 'Get a short-TTL presigned download URL', description: '**Guard:** `deals.view`.' })
  async download(@Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    const data = await this.service.getDownloadUrl(id, attachmentId);
    return { success: true, data };
  }

  @Patch(':id/attachments/:attachmentId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Rename a job attachment / edit its description',
    description: '**Guard:** `deals.edit`.',
  })
  async update(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Body() dto: UpdateAttachmentDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.update(id, attachmentId, dto, user);
    return { success: true, data };
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermission('deals', 'edit')
  @ApiOperation({ summary: 'Delete a job attachment', description: '**Guard:** `deals.edit`.' })
  async remove(@Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    await this.service.delete(id, attachmentId);
    return { success: true, data: null };
  }
}
