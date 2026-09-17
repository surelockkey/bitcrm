import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListTimeClockQueryDto {
  @ApiProperty({
    example: '2026-09-15',
    description:
      'Inclusive range start — a date (whole UTC day) or a full ISO instant.',
  })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-09-21', description: 'Inclusive range end.' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({
    description:
      'Whose timesheet. Defaults to the caller; reading anyone else needs `reports.view`.',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
