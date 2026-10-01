import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { COMMISSION_REPORT_BY, COMMISSION_REPORT_MODES } from '@bitcrm/types';
import { COMMISSION_REPORT_SORT_KEYS } from '../commission-report.types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reports/commissions` (and `/export`). Every parameter is declared —
 * the service's ValidationPipe whitelists, so an undeclared one would vanish.
 * Numbers arrive as strings and are coerced by the service.
 */
export class CommissionReportQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'First day of the period (YYYY-MM-DD). Required.' })
  @IsOptional()
  @Matches(DAY)
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-27', description: 'Last day of the period, inclusive. Defaults to `from`.' })
  @IsOptional()
  @Matches(DAY)
  to?: string;

  @ApiPropertyOptional({
    enum: COMMISSION_REPORT_BY,
    description: 'By Time. `closed` (default) = the end of the visit window, as in Workiz; `created` = the local day.',
  })
  @IsOptional()
  @IsIn(COMMISSION_REPORT_BY)
  by?: string;

  @ApiPropertyOptional({ enum: COMMISSION_REPORT_MODES, description: '`tech` needs `techId`.' })
  @IsOptional()
  @IsIn(COMMISSION_REPORT_MODES)
  mode?: string;

  @ApiPropertyOptional({ description: 'The primary technician (a job shared by several is its primary’s).' })
  @IsOptional()
  @IsString()
  techId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  jobTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceAreaId?: string;

  @ApiPropertyOptional({ description: 'An external company id, or `only` for "External Only" (any company).' })
  @IsOptional()
  @IsString()
  externalCompanyId?: string;

  @ApiPropertyOptional({ description: 'Workiz "Ad Group": the job source id.' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Search: job id, technician, job type, address, area, client, company, ad group.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: COMMISSION_REPORT_SORT_KEYS })
  @IsOptional()
  @IsIn(COMMISSION_REPORT_SORT_KEYS)
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: string;

  @ApiPropertyOptional({ description: 'Rows to skip (default 0).' })
  @IsOptional()
  offset?: string;

  @ApiPropertyOptional({ description: 'Rows per page, 1–500 (default 50).' })
  @IsOptional()
  limit?: string;

  @ApiPropertyOptional({ description: '`1` re-reads the period instead of the minute-old copy.' })
  @IsOptional()
  fresh?: string;
}
