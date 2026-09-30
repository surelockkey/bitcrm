import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Activity report's query. Named in full: deal-service's ValidationPipe
 * strips any property a DTO does not declare.
 */
export class ActivityQueryDto {
  @ApiProperty({ example: '2026-09-01', description: 'First account day (America/New_York), inclusive.' })
  @Matches(DAY, { message: 'from is a YYYY-MM-DD day' })
  from!: string;

  @ApiProperty({ example: '2026-09-27', description: 'Last account day, inclusive.' })
  @Matches(DAY, { message: 'to is a YYYY-MM-DD day' })
  to!: string;

  @ApiPropertyOptional({ description: 'Comma-separated user ids — Workiz’s “Filter results” (at most 20).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  userIds?: string;

  @ApiPropertyOptional({ description: 'Matches the action text and the Job Id, any case.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['desc', 'asc'], description: 'By time; newest first by default.' })
  @IsOptional()
  @IsIn(['desc', 'asc'])
  sort?: 'desc' | 'asc';

  @ApiPropertyOptional({ description: 'Rows per page, 1–100 (Workiz: 5/10/20/25/50/100, default 10).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'The `nextCursor` of the previous page.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  cursor?: string;
}
