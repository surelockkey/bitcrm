import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SEND_TO_TECH_CHANNELS, type SendToTechChannel } from '@bitcrm/types';

/** `POST /deals/:id/send-to-tech` — the Workiz "Send to tech" click. */
export class SendToTechDto {
  @ApiProperty({
    type: [String],
    enum: SEND_TO_TECH_CHANNELS,
    example: ['sms'],
    description:
      'How the job reaches the technician(s): `sms` (personal phone), `email`, `in_app` (team thread). At least one.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(SEND_TO_TECH_CHANNELS, { each: true })
  channels!: SendToTechChannel[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Which of the assigned technicians to notify. Omitted = the whole roster.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  techIds?: string[];
}
