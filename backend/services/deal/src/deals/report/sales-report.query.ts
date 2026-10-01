import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  SALES_REPORT_BY,
  SALES_REPORT_COLUMN_IDS,
  SALES_REPORT_MAX_DAYS,
  SALES_REPORT_MAX_PAGE_SIZE,
  SALES_REPORT_PAYMENT_STATUSES,
  type SalesReportBy,
  type SalesReportColumnId,
  type SalesReportFilters,
  type SalesReportPaymentStatus,
} from '@bitcrm/types';
import { parseJobsReportQuery, type JobsReportQueryDto } from './jobs-report.query';

/** A list parameter: `a,b` or repeated (`?status=a&status=b`) — both arrive here. */
type ListParam = string | string[];

/**
 * `GET /deals/report/sales` and `/deals/report/sales/export`. Every field is
 * declared so the global `whitelist` keeps it; the values are read by
 * `parseSalesReportQuery`, which owns the rules.
 */
export class SalesReportQueryDto {
  @ApiPropertyOptional({ enum: SALES_REPORT_BY, description: 'The date the period is on: created | scheduled (Job date) | end (Job end date). Default: the account setting (Job date).' })
  @IsOptional()
  by?: string;

  @ApiPropertyOptional({ description: 'First day, YYYY-MM-DD (account calendar, America/New_York).' })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: `Last day, inclusive. At most ${SALES_REPORT_MAX_DAYS} days after \`from\`.` })
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Status filter: super-statuses (`done`, `pending`…), comma-separated or repeated.' })
  @IsOptional()
  status?: ListParam;

  @ApiPropertyOptional({ description: 'Team: technician ids (any of them assigned).' })
  @IsOptional()
  techId?: ListParam;

  @ApiPropertyOptional({ description: 'Job type ids.' })
  @IsOptional()
  jobTypeId?: ListParam;

  @ApiPropertyOptional({ enum: SALES_REPORT_PAYMENT_STATUSES.map((p) => p.id), description: 'Payment status: paid | partly_paid | due.' })
  @IsOptional()
  paymentStatus?: ListParam;

  @ApiPropertyOptional({ description: 'Source (job source) ids.' })
  @IsOptional()
  sourceId?: ListParam;

  @ApiPropertyOptional({ description: 'Service area ids.' })
  @IsOptional()
  serviceAreaId?: ListParam;

  @ApiPropertyOptional({ description: 'Search: job number, invoice number, client name, company, email, job name.' })
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ enum: SALES_REPORT_COLUMN_IDS, description: 'Column to sort on. Default `jobNumber` (Workiz: Job ID, newest first).' })
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Default `desc`.' })
  @IsOptional()
  dir?: string;

  @ApiPropertyOptional({ description: '1-based page. Default 1.' })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ description: `Rows per page, 1–${SALES_REPORT_MAX_PAGE_SIZE}. Default 10, as Workiz.` })
  @IsOptional()
  pageSize?: string;

  @ApiPropertyOptional({ description: 'Export only: the columns of the file, in the report order. Default: the account setting.' })
  @IsOptional()
  columns?: ListParam;
}

export interface SalesReportQuery {
  by?: SalesReportBy;
  from: string;
  to: string;
  filters: SalesReportFilters;
  q: string;
  sort: SalesReportColumnId;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  columns?: SalesReportColumnId[];
}

const PAYMENT_STATUSES = new Set<string>(SALES_REPORT_PAYMENT_STATUSES.map((p) => p.id));

function list(raw: ListParam | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => String(v).split(','));
  return [...new Set(parts.map((v) => v.trim()).filter(Boolean))];
}

/**
 * Reads and checks a report query. The period, "By:", the id filters, the
 * statuses, the search and the paging follow the Jobs report's rules — its
 * parser checks them; the sort, the columns and the payment status are the
 * Sales report's own. `by` stays undefined when not given.
 */
export function parseSalesReportQuery(raw: SalesReportQueryDto): SalesReportQuery {
  const base = parseJobsReportQuery({
    by: raw.by,
    from: raw.from,
    to: raw.to,
    status: raw.status,
    techId: raw.techId,
    jobTypeId: raw.jobTypeId,
    sourceId: raw.sourceId,
    serviceAreaId: raw.serviceAreaId,
    q: raw.q,
    dir: raw.dir,
    page: raw.page,
    pageSize: raw.pageSize === undefined || raw.pageSize === '' ? '10' : raw.pageSize,
  } as JobsReportQueryDto);

  const filters: SalesReportFilters = {};
  for (const key of ['status', 'techId', 'jobTypeId', 'sourceId', 'serviceAreaId'] as const) {
    if (base.filters[key]?.length) filters[key] = base.filters[key];
  }
  const payment = list(raw.paymentStatus);
  for (const v of payment) {
    if (!PAYMENT_STATUSES.has(v)) throw new BadRequestException(`paymentStatus must be one of ${[...PAYMENT_STATUSES].join(', ')}`);
  }
  if (payment.length) filters.paymentStatus = payment as SalesReportPaymentStatus[];

  const sort = (raw.sort || 'jobNumber') as SalesReportColumnId;
  if (!SALES_REPORT_COLUMN_IDS.includes(sort)) throw new BadRequestException(`sort: unknown column "${raw.sort}"`);

  let columns: SalesReportColumnId[] | undefined;
  const asked = list(raw.columns);
  if (asked.length) {
    for (const c of asked) {
      if (!SALES_REPORT_COLUMN_IDS.includes(c as SalesReportColumnId)) throw new BadRequestException(`columns: unknown column "${c}"`);
    }
    // The report's fixed order, whatever order they were asked in (Workiz: `disableReorder`).
    columns = SALES_REPORT_COLUMN_IDS.filter((c) => asked.includes(c));
  }

  return {
    by: base.by,
    from: base.from,
    to: base.to,
    filters,
    q: base.q,
    sort,
    dir: base.dir,
    page: base.page,
    pageSize: base.pageSize,
    columns,
  };
}
