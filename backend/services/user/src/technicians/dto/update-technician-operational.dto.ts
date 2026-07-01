import { IsOptional, IsNumber, Min, IsBoolean, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const TECHNICIAN_STATUSES = ['pending', 'active', 'inactive'] as const;

/** Operational settings. Only Manager+ (privileged) callers may edit these. */
export class UpdateTechnicianOperationalDto {
  @ApiPropertyOptional({ example: 45, description: 'Labor cost per hour (USD).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  laborCostPerHour?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  callMaskingEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  gpsTrackingEnabled?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  mobileAppInstalled?: boolean;

  @ApiPropertyOptional({ enum: TECHNICIAN_STATUSES, example: 'active' })
  @IsOptional()
  @IsEnum(TECHNICIAN_STATUSES)
  status?: (typeof TECHNICIAN_STATUSES)[number];
}
