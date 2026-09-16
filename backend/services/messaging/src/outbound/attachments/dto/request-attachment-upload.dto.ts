import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { MESSAGE_ATTACHMENT_TYPES, type MessageAttachmentType } from '@bitcrm/types';
import { MAX_ATTACHMENT_BYTES } from '../../dto/send-message.dto';

/** `POST /attachments/presign` (design §7.2 `RequestAttachmentUploadDto`, §4.6 types and size). */
export class RequestAttachmentUploadDto {
  @ApiProperty({ example: 'front-door.jpg' })
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @ApiProperty({ enum: MESSAGE_ATTACHMENT_TYPES, example: 'image/jpeg', description: 'The MIME types Twilio MMS carries.' })
  @IsIn(MESSAGE_ATTACHMENT_TYPES)
  contentType!: MessageAttachmentType;

  @ApiProperty({ example: 1048576, description: 'Bytes; at most 5 MB (Twilio: 5 MB per message).' })
  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  size!: number;
}
