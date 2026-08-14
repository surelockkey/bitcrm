import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Telephony telling a job that a call was attached to it, or detached. */
export class RecordCallLinkDto {
  @ApiProperty({ example: 'CAxxxxxxxx' })
  @IsString()
  callSid!: string;

  @ApiPropertyOptional({ default: true, description: 'false = detached' })
  @IsOptional()
  @IsBoolean()
  linked?: boolean;

  @ApiProperty({ description: 'Who did it — telephony resolves the name.' })
  @IsString()
  actorId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorName?: string;

  @ApiPropertyOptional({
    description:
      'Rendered on the timeline entry: direction, duration, the other party, ' +
      'and whether a recording exists.',
  })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
