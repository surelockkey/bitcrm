import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SEND_TO_TECH_CHANNELS, type SendToTechChannel } from '@bitcrm/types';

const E164 = /^\+[1-9]\d{6,14}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A base URL; `{{deal_id}}` / `{{job_id}}` tokens are allowed inside it. */
const BASE_URL = /^https?:\/\/\S+$/i;

export class QuietHoursDto {
  @ApiProperty({ example: '20:00', description: '`HH:mm`, local to `timezone`.' })
  @Matches(HH_MM, { message: 'from must be HH:mm' })
  from!: string;

  @ApiProperty({ example: '08:00' })
  @Matches(HH_MM, { message: 'to must be HH:mm' })
  to!: string;

  @ApiProperty({ example: 'America/New_York', description: 'IANA zone.' })
  @IsString()
  @Length(1, 64)
  timezone!: string;
}

/**
 * `PUT /settings` body (design §3.2 `MESSAGING#SETTINGS`, §4.7). Fields
 * merge over the stored document — omit what you do not change, send `""`
 * to clear a text field. Workiz names (`smsFormat`, `smsPre`, `sndFwd`, …)
 * are kept so the `account_sms_settings` import is a straight copy.
 */
export class UpdateMessagingSettingsDto {
  @ApiPropertyOptional({ example: '+12034036303', description: 'E.164 fallback sender (Workiz `snd_number`).' })
  @IsOptional()
  @Matches(E164, { message: 'defaultSenderNumber must be E.164' })
  defaultSenderNumber?: string;

  @ApiPropertyOptional({ type: [String], description: 'Numbers that forward to the default sender (Workiz `snd_fwd`).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(E164, { each: true, message: 'sndFwd entries must be E.164' })
  sndFwd?: string[];

  @ApiPropertyOptional({ description: 'The "New job" SMS to technicians (Workiz `sms_format`); short codes allowed.', maxLength: 1600 })
  @IsOptional()
  @IsString()
  @Length(0, 1600)
  smsFormat?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: SEND_TO_TECH_CHANNELS,
    example: ['sms'],
    description: 'Channels the "Send to tech" dialog ticks by default; `[]` clears it back to `sms`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(SEND_TO_TECH_CHANNELS, { each: true })
  sendToTechChannels?: SendToTechChannel[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  useCloseLink?: boolean;

  @ApiPropertyOptional({ description: 'Prepended to every outbound SMS (Workiz `sms_pre`).', maxLength: 160 })
  @IsOptional()
  @IsString()
  @Length(0, 160)
  smsPre?: string;

  @ApiPropertyOptional({ description: 'Appended to every outbound SMS.', maxLength: 160 })
  @IsOptional()
  @IsString()
  @Length(0, 160)
  signature?: string;

  @ApiPropertyOptional({ description: 'Tech "on my way" text; short codes allowed.', maxLength: 1600 })
  @IsOptional()
  @IsString()
  @Length(0, 1600)
  onMyWayMsg?: string;

  @ApiPropertyOptional({ description: 'Tech "late" text; `{{late_value}}` is the minutes.', maxLength: 1600 })
  @IsOptional()
  @IsString()
  @Length(0, 1600)
  lateMsg?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onMyWayMsgNotify?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  lateMsgNotify?: boolean;

  @ApiPropertyOptional({ type: QuietHoursDto, description: 'Automations hold non-urgent messages in this window; manual sends only warn.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuietHoursDto)
  quietHours?: QuietHoursDto;

  @ApiPropertyOptional({ example: 'https://book.example.com/confirm', description: 'Base of `{{confirm_link}}`.' })
  @IsOptional()
  @Matches(BASE_URL, { message: 'confirmLinkBaseUrl must be an http(s) URL' })
  @Length(0, 500)
  confirmLinkBaseUrl?: string;

  @ApiPropertyOptional({ example: 'https://book.example.com/job/{{deal_id}}', description: 'Base of `{{info_link}}`.' })
  @IsOptional()
  @Matches(BASE_URL, { message: 'infoLinkBaseUrl must be an http(s) URL' })
  @Length(0, 500)
  infoLinkBaseUrl?: string;

  @ApiPropertyOptional({ description: 'Sent after a STOP where Twilio does not answer itself (§4.7).', maxLength: 320 })
  @IsOptional()
  @IsString()
  @Length(0, 320)
  stopReplyText?: string;

  @ApiPropertyOptional({ description: 'HELP reply — must name the company and a phone (campaign requirement, §4.8).', maxLength: 320 })
  @IsOptional()
  @IsString()
  @Length(0, 320)
  helpReplyText?: string;

  @ApiPropertyOptional({ example: 'Sure Lock & Key', description: '`{{biz_name}}`.', maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  companyName?: string;

  @ApiPropertyOptional({ example: '+12034036303', description: '`{{biz_number}}`; E.164.' })
  @IsOptional()
  @Matches(E164, { message: 'companyPhone must be E.164' })
  companyPhone?: string;

  @ApiPropertyOptional({ example: 'office@example.com', description: '`{{biz_email}}`.' })
  @IsOptional()
  @IsEmail()
  companyEmail?: string;

  @ApiPropertyOptional({ example: 'America/New_York', description: 'Company default zone for date/time short codes.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;
}
