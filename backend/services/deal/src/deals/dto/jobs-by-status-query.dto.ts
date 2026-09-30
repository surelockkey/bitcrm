import { IsISO8601 } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The window of the dashboard's "Jobs By Status" chart. Days, not instants:
 * the chart draws one bar group per calendar day, and a time-of-day would
 * only make the boundary ambiguous.
 */
export class JobsByStatusQueryDto {
  @ApiProperty({ example: '2026-09-14', description: 'First day of the window (YYYY-MM-DD).' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-09-28', description: 'Last day of the window, inclusive.' })
  @IsISO8601({ strict: true })
  to!: string;
}
