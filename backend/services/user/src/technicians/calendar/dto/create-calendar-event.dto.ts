import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CalendarEventType } from '@bitcrm/types';

/**
 * Structural validation only. The startDate/endDate/allDay/timeSlot coherence
 * rules (all-day vs single-day timed) are enforced in the service via
 * `validateEventShape`, so they live in one place shared with update.
 */
export class CreateCalendarEventDto {
  @ApiProperty({ enum: CalendarEventType, example: CalendarEventType.TIME_OFF })
  @IsEnum(CalendarEventType)
  type!: CalendarEventType;

  @ApiProperty({ example: 'Vacation', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: '2026-07-24', description: 'Inclusive local date YYYY-MM-DD.' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-07-26', description: 'Inclusive local date YYYY-MM-DD.' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  allDay!: boolean;

  @ApiPropertyOptional({ example: '12:00-13:00', description: 'Required when allDay is false.' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}-\d{2}:\d{2}$/, { message: 'timeSlot must match HH:MM-HH:MM' })
  timeSlot?: string;
}
