import { IsISO8601 } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JobsByStatusQueryDto } from '../dto/jobs-by-status-query.dto';

/** The dashboard's opening window, and the day "Today" is about. */
export class DashboardBundleQueryDto extends JobsByStatusQueryDto {
  @ApiProperty({ example: '2026-09-28', description: 'Today on the account\'s calendar (YYYY-MM-DD).' })
  @IsISO8601({ strict: true })
  day!: string;
}
