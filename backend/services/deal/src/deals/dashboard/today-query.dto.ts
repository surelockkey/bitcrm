import { IsISO8601 } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The "Today" widget's day. Sent by the browser rather than taken from the
 * server clock: at 8pm in New York the server's date is already tomorrow.
 */
export class TodayQueryDto {
  @ApiProperty({ example: '2026-09-28', description: 'The viewer\'s calendar day (YYYY-MM-DD).' })
  @IsISO8601({ strict: true })
  day!: string;
}
