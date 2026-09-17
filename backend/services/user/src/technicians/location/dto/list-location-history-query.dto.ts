import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ListLocationHistoryQueryDto {
  @ApiProperty({
    example: '2026-09-17',
    description:
      'Inclusive range start — a date (whole UTC day) or a full ISO instant.',
  })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-09-17', description: 'Inclusive range end.' })
  @IsDateString()
  to!: string;
}
