import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  JobSuperStatus,
  JOBS_REPORT_BY,
  JOBS_REPORT_COLUMN_IDS,
  JOBS_REPORT_MAX_DAYS,
  JOBS_REPORT_MAX_PAGE_SIZE,
  type JobsReportBy,
  type JobsReportColumnId,
  type JobsReportFilters,
  type JobsReportOrigin,
} from '@bitcrm/types';

/** A list parameter: `a,b` or repeated (`?status=a&status=b`) — both arrive here. */
type ListParam = string | string[];

/**
 * `GET /deals/report` and `/deals/report/export`. Every field is declared so
 * the global `whitelist` keeps it; the values are read by
 * `parseJobsReportQuery`, which owns the rules.
 */
export class JobsReportQueryDto {
  @ApiPropertyOptional({ enum: JOBS_REPORT_BY, description: 'The date the period is on: created | scheduled (Job date) | end (Job end date). Default: the account setting.' })
  @IsOptional()
  by?: string;

  @ApiPropertyOptional({ description: 'First day, YYYY-MM-DD (account calendar, America/New_York).' })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: `Last day, inclusive. At most ${JOBS_REPORT_MAX_DAYS} days after \`from\`.` })
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Status filter: `done` or `done:<subStatusId>`, comma-separated or repeated.' })
  @IsOptional()
  status?: ListParam;

  @ApiPropertyOptional({ description: 'Team: technician ids (any of them assigned).' })
  @IsOptional()
  techId?: ListParam;

  @ApiPropertyOptional({ description: 'Created by: user ids.' })
  @IsOptional()
  createdBy?: ListParam;

  @ApiPropertyOptional({ description: 'Tag ids (any of them).' })
  @IsOptional()
  tagId?: ListParam;

  @ApiPropertyOptional({ description: 'Job type ids.' })
  @IsOptional()
  jobTypeId?: ListParam;

  @ApiPropertyOptional({ description: 'Job origin: lead | new.' })
  @IsOptional()
  origin?: ListParam;

  @ApiPropertyOptional({ description: 'Source (job source) ids.' })
  @IsOptional()
  sourceId?: ListParam;

  @ApiPropertyOptional({ description: 'Service area ids.' })
  @IsOptional()
  serviceAreaId?: ListParam;

  @ApiPropertyOptional({ description: 'External company ids (Workiz "Companies").' })
  @IsOptional()
  externalCompanyId?: ListParam;

  @ApiPropertyOptional({ description: 'Search: job #, job name, client, phone, email, address.' })
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ enum: JOBS_REPORT_COLUMN_IDS, description: 'Column to sort on. Default `created`.' })
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Default `desc`.' })
  @IsOptional()
  dir?: string;

  @ApiPropertyOptional({ description: '1-based page. Default 1.' })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ description: `Rows per page, 1–${JOBS_REPORT_MAX_PAGE_SIZE}. Default 50.` })
  @IsOptional()
  pageSize?: string;

  @ApiPropertyOptional({ description: 'Export only: the columns of the file, in the report order. Default: the account setting.' })
  @IsOptional()
  columns?: ListParam;
}

export interface JobsReportQuery {
  by?: JobsReportBy;
  from: string;
  to: string;
  filters: JobsReportFilters;
  q: string;
  sort: JobsReportColumnId;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  columns?: JobsReportColumnId[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;
const SUPER_STATUSES = new Set<string>(Object.values(JobSuperStatus));

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

/** Reads and checks a report query. `by` stays undefined when not given — the account setting decides. */
export function parseJobsReportQuery(raw: JobsReportQueryDto): JobsReportQuery {
  let by: JobsReportBy | undefined;
  if (raw.by !== undefined && raw.by !== '') {
    if (!(JOBS_REPORT_BY as readonly string[]).includes(raw.by)) {
      throw new BadRequestException(`by must be one of ${JOBS_REPORT_BY.join(', ')}`);
    }
    by = raw.by as JobsReportBy;
  }

  const from = day(raw.from, 'from');
  const to = raw.to ? day(raw.to, 'to') : from;
  if (to < from) throw new BadRequestException('to is before from');
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > JOBS_REPORT_MAX_DAYS) throw new BadRequestException(`The period is at most ${JOBS_REPORT_MAX_DAYS} days`);

  const status = list(raw.status);
  for (const v of status) {
    const [sup, sub, extra] = v.split(':');
    if (!SUPER_STATUSES.has(sup) || extra !== undefined || (sub !== undefined && !ID.test(sub))) {
      throw new BadRequestException(`status: "${v}" is not a status or status:subStatusId`);
    }
  }
  const origin = list(raw.origin);
  for (const v of origin) if (v !== 'lead' && v !== 'new') throw new BadRequestException('origin must be lead or new');

  const filters: JobsReportFilters = {};
  if (status.length) filters.status = status;
  if (origin.length) filters.origin = origin as JobsReportOrigin[];
  for (const key of ['techId', 'createdBy', 'tagId', 'jobTypeId', 'sourceId', 'serviceAreaId', 'externalCompanyId'] as const) {
    const values = ids(raw[key], key);
    if (values) filters[key] = values;
  }

  const sort = (raw.sort || 'created') as JobsReportColumnId;
  if (!JOBS_REPORT_COLUMN_IDS.includes(sort)) throw new BadRequestException(`sort: unknown column "${raw.sort}"`);
  const dir = raw.dir === 'asc' ? 'asc' : raw.dir === undefined || raw.dir === '' || raw.dir === 'desc' ? 'desc' : null;
  if (!dir) throw new BadRequestException('dir must be asc or desc');

  const page = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
  const pageSize = raw.pageSize === undefined || raw.pageSize === '' ? 50 : Number(raw.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > JOBS_REPORT_MAX_PAGE_SIZE) {
    throw new BadRequestException(`pageSize must be 1–${JOBS_REPORT_MAX_PAGE_SIZE}`);
  }

  let columns: JobsReportColumnId[] | undefined;
  const asked = list(raw.columns);
  if (asked.length) {
    for (const c of asked) {
      if (!JOBS_REPORT_COLUMN_IDS.includes(c as JobsReportColumnId)) throw new BadRequestException(`columns: unknown column "${c}"`);
    }
    // The report's fixed order, whatever order they were asked in (Workiz: `disableReorder`).
    columns = JOBS_REPORT_COLUMN_IDS.filter((c) => asked.includes(c));
  }

  const q = (raw.q ?? '').trim().slice(0, 200);
  return { by, from, to, filters, q, sort, dir, page, pageSize, columns };
}
