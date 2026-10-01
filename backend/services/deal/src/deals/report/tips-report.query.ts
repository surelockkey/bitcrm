import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  TIPS_REPORT_JOBS_MAX_PAGE_SIZE,
  TIPS_REPORT_JOBS_PAGE_SIZE,
  TIPS_REPORT_JOB_SORTS,
  TIPS_REPORT_MAX_DAYS,
  type TipsReportFilters,
  type TipsReportJobSort,
} from '@bitcrm/types';

/** A list parameter: `a,b` or repeated (`?techId=a&techId=b`) — both arrive here. */
type ListParam = string | string[];

/**
 * `GET /deals/report/tips`. Every field is declared so the global
 * `whitelist` keeps it; `parseTipsReportQuery` owns the rules.
 */
export class TipsReportQueryDto {
  @ApiProperty({ description: 'First day, YYYY-MM-DD, of the JOB DATE (account calendar, America/New_York).' })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: `Last day, inclusive. At most ${TIPS_REPORT_MAX_DAYS} days after \`from\`. Default \`from\`.` })
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Tech: the people whose rows to show, comma-separated or repeated.' })
  @IsOptional()
  techId?: ListParam;

  @ApiPropertyOptional({ description: 'Job type ids — only jobs of these types count.' })
  @IsOptional()
  jobTypeId?: ListParam;

  @ApiPropertyOptional({ description: 'Client (contact) ids — only these clients\' jobs count.' })
  @IsOptional()
  contactId?: ListParam;
}

/** `GET /deals/report/tips/jobs` — one person's jobs: the report's query, plus who, the sort and the page. */
export class TipsReportJobsQueryDto extends TipsReportQueryDto {
  @ApiProperty({ description: 'The person whose jobs to list.' })
  @IsOptional()
  tech?: string;

  @ApiPropertyOptional({ enum: TIPS_REPORT_JOB_SORTS, description: 'Default `default` — the order the jobs were created in.' })
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Default `asc`.' })
  @IsOptional()
  dir?: string;

  @ApiPropertyOptional({ description: '1-based page. Default 1.' })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ description: `Rows per page, 1–${TIPS_REPORT_JOBS_MAX_PAGE_SIZE}. Default ${TIPS_REPORT_JOBS_PAGE_SIZE}.` })
  @IsOptional()
  pageSize?: string;
}

export interface TipsReportQuery {
  from: string;
  to: string;
  filters: TipsReportFilters;
}

export interface TipsReportJobsQuery extends TipsReportQuery {
  tech: string;
  sort: TipsReportJobSort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

function list(raw: ListParam | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => String(v).split(','));
  return [...new Set(parts.map((v) => v.trim()).filter(Boolean))];
}

function ids(raw: ListParam | undefined, field: string): string[] | undefined {
  const out = list(raw);
  if (out.length > 200) throw new BadRequestException(`${field}: at most 200 values`);
  for (const v of out) if (!ID.test(v)) throw new BadRequestException(`${field}: "${v}" is not an id`);
  return out.length ? out : undefined;
}

function day(value: string | undefined, field: string): string {
  if (!value || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`${field} must be a YYYY-MM-DD date`);
  }
  return value;
}

export function parseTipsReportQuery(raw: TipsReportQueryDto): TipsReportQuery {
  const from = day(raw.from, 'from');
  const to = raw.to ? day(raw.to, 'to') : from;
  if (to < from) throw new BadRequestException('to is before from');
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > TIPS_REPORT_MAX_DAYS) throw new BadRequestException(`The period is at most ${TIPS_REPORT_MAX_DAYS} days`);
  const filters: TipsReportFilters = {};
  for (const key of ['techId', 'jobTypeId', 'contactId'] as const) {
    const values = ids(raw[key], key);
    if (values) filters[key] = values;
  }
  return { from, to, filters };
}

export function parseTipsReportJobsQuery(raw: TipsReportJobsQueryDto): TipsReportJobsQuery {
  const base = parseTipsReportQuery(raw);
  const tech = (raw.tech ?? '').trim();
  if (!ID.test(tech)) throw new BadRequestException('tech must be a user id');
  const sort = (raw.sort || 'default') as TipsReportJobSort;
  if (!TIPS_REPORT_JOB_SORTS.includes(sort)) throw new BadRequestException(`sort: unknown column "${raw.sort}"`);
  const dir = raw.dir === 'desc' ? 'desc' : raw.dir === undefined || raw.dir === '' || raw.dir === 'asc' ? 'asc' : null;
  if (!dir) throw new BadRequestException('dir must be asc or desc');
  const page = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
  const pageSize = raw.pageSize === undefined || raw.pageSize === '' ? TIPS_REPORT_JOBS_PAGE_SIZE : Number(raw.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > TIPS_REPORT_JOBS_MAX_PAGE_SIZE) {
    throw new BadRequestException(`pageSize must be 1–${TIPS_REPORT_JOBS_MAX_PAGE_SIZE}`);
  }
  return { ...base, tech, sort, dir, page, pageSize };
}
