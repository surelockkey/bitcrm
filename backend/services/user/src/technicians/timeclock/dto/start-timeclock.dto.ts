import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TIME_CLOCK_SOURCES, type TimeClockSource } from '@bitcrm/types';

export class StartTimeClockDto {
  @ApiPropertyOptional({
    description:
      'The job the clock was started from ("clock in to a job" — the Start ' +
      'quick action). Absent when clocking in to the day.',
  })
  @IsOptional()
  @IsString()
  dealId?: string;

  @ApiPropertyOptional({ example: 33.749, description: 'Omitted if location permission was refused.' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: -84.388 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ example: 15, description: 'GPS accuracy in metres.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @ApiProperty({ enum: TIME_CLOCK_SOURCES, example: 'mobile' })
  @IsIn(TIME_CLOCK_SOURCES as unknown as string[])
  source!: TimeClockSource;
}
