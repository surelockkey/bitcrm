import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MESSAGE_TEMPLATE_CHANNELS, type MessageTemplateChannel } from '@bitcrm/types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Design §7.2 `MessageTemplateDto`, field names after the Workiz export so
 * the 39 imported templates round-trip through the editor unchanged.
 * `messageTemplate` is HTML (≤ 10 000); for `sms` templates the service also
 * checks that the *plain-text* rendering fits `SMS_BODY_MAX_LENGTH` (1 600).
 */
export class CreateMessageTemplateDto {
  @ApiProperty({ example: 'Signature request', maxLength: 120 })
  @IsString()
  @Transform(trim)
  @Length(1, 120)
  messageTemplateTitle!: string;

  @ApiProperty({
    example: '<p>Hi, {{client_first_name}}! Please confirm services with us by signing the invoice.</p>',
    description: 'HTML body with `{{short_code}}` placeholders. Plain text is accepted too.',
    maxLength: 10000,
  })
  @IsString()
  @Length(1, 10000)
  messageTemplate!: string;

  @ApiPropertyOptional({ description: 'Draft.js raw content, when the editor produced one.' })
  @IsOptional()
  @IsObject()
  messageJson?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Car key copy appointment', maxLength: 250 })
  @IsOptional()
  @IsString()
  @Length(0, 250)
  messageSubjectTemplate?: string;

  @ApiPropertyOptional({ description: 'Draft.js raw content of the subject.' })
  @IsOptional()
  @IsObject()
  messageSubjectJson?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Sure Lock & Key', maxLength: 120 })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  messageFrom?: string;

  @ApiProperty({ enum: MESSAGE_TEMPLATE_CHANNELS, example: 'sms' })
  @IsIn(MESSAGE_TEMPLATE_CHANNELS)
  channel!: MessageTemplateChannel;

  @ApiPropertyOptional({ example: false, description: 'Defaults to false. At most one default per channel.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: 'Follow-up', maxLength: 60, description: 'Free-text group in the picker.' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 60)
  category?: string;

  @ApiPropertyOptional({ example: true, description: 'Defaults to true. `false` archives (hides from the picker).' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
