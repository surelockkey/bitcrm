import {
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  IsEnum,
  IsArray,
  IsInt,
  Matches,
} from 'class-validator';
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

  @ApiPropertyOptional({ type: [Number], example: [1, 2, 3, 4, 5], description: 'Working days: 0=Sun … 6=Sat.' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];

  @ApiPropertyOptional({ example: '08:00', description: 'Shift start HH:MM (24h).' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'workStart must match HH:MM' })
  workStart?: string;

  @ApiPropertyOptional({ example: '17:00', description: 'Shift end HH:MM (24h).' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'workEnd must match HH:MM' })
  workEnd?: string;
}
