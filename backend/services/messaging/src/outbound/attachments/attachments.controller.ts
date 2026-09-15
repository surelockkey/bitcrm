import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { OutboundAttachmentsService } from './attachments.service';
import { RequestAttachmentUploadDto } from './dto/request-attachment-upload.dto';

/** Composer uploads for outbound MMS (design §4.6). Gated by `messages.send`. */
@ApiTags('Messaging')
@ApiBearerAuth()
@Controller('attachments')
export class OutboundAttachmentsController {
  constructor(private readonly service: OutboundAttachmentsService) {}

  @Post('presign')
  @RequirePermission('messages', 'send')
  @ApiOperation({
    summary: 'Request a presigned (SSE-KMS) upload URL for an outbound attachment',
    description:
      '**Guard:** `messages.send`. Validates the MIME type and size Twilio MMS accepts (§4.6). The ' +
      'returned `headers` must be replayed on the PUT; the returned `id` (with fileName / contentType / ' +
      'size) goes into `attachments[]` of the send request. Keys live under `messaging/uploads/<userId>/`.',
  })
  async presign(@Body() dto: RequestAttachmentUploadDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.requestUpload(dto, user);
    return { success: true, data };
  }
}
