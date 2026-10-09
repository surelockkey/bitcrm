import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ESTIMATE_STATUSES, type EstimateStatus } from '@bitcrm/types';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { REPORT_DAY } from '../../../common/dto/report-query.util';

/** The Estimates report: created-date window (business days), status, search. */
export class EstimateReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Created on or after (business day). Both absent = All time.' })
  @IsOptional()
  @Matches(REPORT_DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-27', description: 'Created on or before (business day), inclusive.' })
  @IsOptional()
  @Matches(REPORT_DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({ enum: ESTIMATE_STATUSES })
  @IsOptional()
  @IsIn(ESTIMATE_STATUSES as unknown as string[])
  status?: EstimateStatus;

  @ApiPropertyOptional({ description: 'Estimate number or name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Created order: newest first (`desc`, the default) or oldest first (Workiz’s Created header clicked).',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}
