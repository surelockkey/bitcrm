import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

/** `POST /automations/late` — the technician is running late. */
export class LateDto {
  @ApiProperty({ description: 'The job (deal id) the caller is assigned to.' })
  @IsString()
  @Length(1, 64)
  dealId!: string;

  @ApiProperty({ description: 'How many minutes late; rendered as `{{late_value}}`.', minimum: 1, maximum: 600 })
  @IsInt()
  @Min(1)
  @Max(600)
  minutes!: number;

  @ApiPropertyOptional({ description: 'Idempotency key; without it two taps within 15 minutes count as one.' })
  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
