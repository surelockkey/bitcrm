import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListCalendarEventsQueryDto {
  @ApiProperty({ example: '2026-07-20', description: 'Inclusive range start YYYY-MM-DD.' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-07-26', description: 'Inclusive range end YYYY-MM-DD.' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({
    example: 'tech-1,tech-2',
    description: 'Comma-separated technician ids (bulk grid endpoint only).',
  })
  @IsOptional()
  @IsString()
  techIds?: string;
}
