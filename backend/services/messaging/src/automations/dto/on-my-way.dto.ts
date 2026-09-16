import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

/** `POST /automations/on-my-way` — the technician is heading to the job. */
export class OnMyWayDto {
  @ApiProperty({ description: 'The job (deal id) the caller is assigned to.' })
  @IsString()
  @Length(1, 64)
  dealId!: string;

  @ApiPropertyOptional({ description: 'Minutes until arrival; exposed to the template as `{{eta_minutes}}`.', minimum: 1, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  etaMinutes?: number;

  @ApiPropertyOptional({ description: 'Idempotency key; without it two taps within 15 minutes count as one.' })
  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
