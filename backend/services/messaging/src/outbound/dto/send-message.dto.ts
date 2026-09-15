import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MESSAGE_ATTACHMENT_LIMIT,
  MESSAGE_ATTACHMENT_TYPES,
  SENDABLE_MESSAGE_CHANNELS,
  SMS_BODY_MAX_LENGTH,
  type MessageAttachmentType,
  type SendableMessageChannel,
} from '@bitcrm/types';

/** E.164, as the design's DTO (§7.2) and the phone index both expect. */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/** Twilio's ceiling for one MMS: 10 files, 5 MB together (design §4.6). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Most user ids one in-app line may mention (design §6). */
export const MENTIONS_LIMIT = 50;

/**
 * One file the composer already PUT to S3 through
 * `POST /attachments/presign`. `id` is the id that call returned; the object
 * key is derived from it and the caller (`messaging/uploads/<userId>/<id>`),
 * so a request can only ever reference its own uploads.
 */
export class SendAttachmentDto {
  @ApiProperty({ description: 'The id returned by POST /attachments/presign.' })
  @IsUUID()
  id!: string;

  @ApiProperty({ example: 'front-door.jpg' })
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @ApiProperty({ enum: MESSAGE_ATTACHMENT_TYPES, example: 'image/jpeg' })
  @IsIn(MESSAGE_ATTACHMENT_TYPES)
  contentType!: MessageAttachmentType;

  @ApiProperty({ description: 'Bytes. At most 5 MB, and 5 MB across the whole message.' })
  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  size!: number;
}

/** `POST /conversations/:id/messages` (design §7.2 `SendMessageDto`). */
export class SendMessageDto {
  @ApiProperty({
    description:
      'Idempotency key minted by the composer (uuid). A repeated submit with the same key returns the first message.',
  })
  @IsUUID()
  clientMessageId!: string;

  @ApiProperty({ enum: SENDABLE_MESSAGE_CHANNELS, example: 'sms' })
  @IsIn(SENDABLE_MESSAGE_CHANNELS)
  channel!: SendableMessageChannel;

  @ApiProperty({ description: `Plain text, at most ${SMS_BODY_MAX_LENGTH} characters for SMS.` })
  @ValidateIf((o: SendMessageDto) => o.channel !== 'email' || !o.attachments?.length)
  @IsString()
  @Length(1, SMS_BODY_MAX_LENGTH)
  body!: string;

  @ApiPropertyOptional({ description: 'Email only.' })
  @ValidateIf((o: SendMessageDto) => o.channel === 'email')
  @IsString()
  @Length(1, 250)
  subject?: string;

  @ApiPropertyOptional({
    description: 'E.164 company number the agent picked in the composer; must be one the workspace may text from.',
    example: '+14045550100',
  })
  @IsOptional()
  @Matches(E164_PATTERN, { message: 'fromNumber must be E.164' })
  fromNumber?: string;

  @ApiPropertyOptional({
    description: "One of the party's addresses (E.164 or email). Defaults to the conversation's primary one.",
  })
  @IsOptional()
  @IsString()
  toAddress?: string;

  @ApiPropertyOptional({ description: 'Job this message is about; indexed on JobIndex.' })
  @IsOptional()
  @IsUUID()
  dealId?: string;

  @ApiPropertyOptional({ description: 'Template the body was rendered from (recorded; rendering is the templates module).' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ type: [SendAttachmentDto], description: 'Uploads to send as MMS media (≤ 10, ≤ 5 MB total).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MESSAGE_ATTACHMENT_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => SendAttachmentDto)
  attachments?: SendAttachmentDto[];

  @ApiPropertyOptional({
    type: [String],
    description: 'User ids @-mentioned in the body — `in_app` lines in team / group threads only; carried on the message and the realtime event.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MENTIONS_LIMIT)
  @IsString({ each: true })
  @Length(1, 200, { each: true })
  mentions?: string[];
}

/**
 * `POST /messages` — send to a party that may not have a conversation yet.
 * Exactly one of `contactId` / `phone` picks the party: a contact gets (or
 * already has) its `client` conversation; a bare number is looked up in CRM
 * and, when nobody owns it, opens an `unknown` conversation keyed by the
 * address, as an inbound text from it would (design §4.3).
 */
export class StartConversationMessageDto extends SendMessageDto {
  @ApiPropertyOptional({ description: 'CRM contact to text. Required unless `phone` is given.' })
  @ValidateIf((o: StartConversationMessageDto) => !o.phone)
  @IsUUID()
  contactId?: string;

  @ApiPropertyOptional({ description: 'E.164 number to text. Required unless `contactId` is given.', example: '+14045551234' })
  @ValidateIf((o: StartConversationMessageDto) => !o.contactId)
  @Matches(E164_PATTERN, { message: 'phone must be E.164' })
  phone?: string;
}
