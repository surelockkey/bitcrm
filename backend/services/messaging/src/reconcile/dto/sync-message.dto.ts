import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsString, Length } from 'class-validator';

/** `POST /internal/reconcile/message` — the key of one outbound message. */
export class SyncMessageDto {
  @ApiProperty({ description: 'The conversation the message is in.' })
  @IsString()
  @Length(1, 200)
  conversationId!: string;

  @ApiProperty({ description: "The message's createdAt exactly as listed (it is part of the sort key)." })
  @IsString()
  @IsISO8601({ strict: true })
  createdAt!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  messageId!: string;
}
