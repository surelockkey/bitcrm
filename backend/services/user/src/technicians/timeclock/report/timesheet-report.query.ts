import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  TIMESHEET_JOB_FILTERS,
  TIMESHEET_REPORT_DEFAULT_PAGE_SIZE,
  TIMESHEET_REPORT_MAX_DAYS,
  TIMESHEET_REPORT_MAX_PAGE_SIZE,
  TIMESHEET_REPORT_SORTS,
  type TimesheetJobFilter,
  type TimesheetReportFilters,
  type TimesheetReportSort,
} from '@bitcrm/types';
import { daysInclusive, isDay } from '../account-clock.util';

/** A list parameter: `a,b` or repeated (`?userId=a&userId=b`) — both arrive here. */
type ListParam = string | string[];

const PERIOD_HELP =
  '`from`/`to` = YYYY-MM-DD on the account\'s calendar (America/New_York), both included, ' +
  `at most ${TIMESHEET_REPORT_MAX_DAYS} days; an entry belongs to the day it STARTED on.`;

/**
 * `GET /users/timeclock/report`. Every field is declared so the global
 * `whitelist` keeps it; `parseTimesheetReportQuery` owns the rules.
 */
export class TimesheetReportQueryDto {
  @ApiPropertyOptional({ description: `First day. ${PERIOD_HELP}` })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Last day, inclusive. Default: `from`.' })
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Team: these people only — user ids, comma-separated or repeated.' })
  @IsOptional()
  userId?: ListParam;

  @ApiPropertyOptional({ enum: TIMESHEET_JOB_FILTERS, description: 'Jobs: with_job | without_job (both = no filter).' })
  @IsOptional()
  job?: ListParam;

  @ApiPropertyOptional({ description: 'Search on the person\'s name (case-insensitive, any part).' })
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ enum: TIMESHEET_REPORT_SORTS, description: 'Default `name` — Workiz opens its report on User, descending.' })
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Default `desc`.' })
  @IsOptional()
  dir?: string;

  @ApiPropertyOptional({ description: '1-based page. Default 1.' })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ description: `Rows per page, 1–${TIMESHEET_REPORT_MAX_PAGE_SIZE}. Default ${TIMESHEET_REPORT_DEFAULT_PAGE_SIZE}.` })
  @IsOptional()
  pageSize?: string;
}

/** `GET /users/timeclock/report/entries` — one person's entries of the period. */
export class TimesheetEntriesQueryDto {
  @ApiPropertyOptional({ description: 'Whose entries (required).' })
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ description: `First day. ${PERIOD_HELP}` })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'Last day, inclusive. Default: `from`.' })
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ enum: TIMESHEET_JOB_FILTERS, description: 'The report\'s Jobs filter, carried into the opened row.' })
  @IsOptional()
  job?: ListParam;
}

export interface TimesheetReportQuery {
  from: string;
  to: string;
  filters: TimesheetReportFilters;
  q: string;
  sort: TimesheetReportSort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface TimesheetEntriesQuery {
  userId: string;
  from: string;
  to: string;
  job?: TimesheetJobFilter[];
}

const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;

function list(raw: ListParam | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => String(v).split(','));
  return [...new Set(parts.map((v) => v.trim()).filter(Boolean))];
}

function period(rawFrom: string | undefined, rawTo: string | undefined): { from: string; to: string } {
  if (!isDay(rawFrom)) throw new BadRequestException('from must be a YYYY-MM-DD date');
  if (rawTo !== undefined && rawTo !== '' && !isDay(rawTo)) {
    throw new BadRequestException('to must be a YYYY-MM-DD date');
  }
  const from = rawFrom;
  const to = rawTo || from;
  if (to < from) throw new BadRequestException('to is before from');
  if (daysInclusive(from, to) > TIMESHEET_REPORT_MAX_DAYS) {
    throw new BadRequestException(`The period is at most ${TIMESHEET_REPORT_MAX_DAYS} days`);
  }
  return { from, to };
}

function jobs(raw: ListParam | undefined): TimesheetJobFilter[] | undefined {
  const values = list(raw);
  for (const v of values) {
    if (!(TIMESHEET_JOB_FILTERS as readonly string[]).includes(v)) {
      throw new BadRequestException(`job must be ${TIMESHEET_JOB_FILTERS.join(' or ')}`);
    }
  }
  return values.length ? (values as TimesheetJobFilter[]) : undefined;
}

export function parseTimesheetReportQuery(raw: TimesheetReportQueryDto): TimesheetReportQuery {
  const { from, to } = period(raw.from, raw.to);

  const filters: TimesheetReportFilters = {};
  const users = list(raw.userId);
  if (users.length > 500) throw new BadRequestException('userId: at most 500 values');
  for (const v of users) if (!ID.test(v)) throw new BadRequestException(`userId: "${v}" is not an id`);
  if (users.length) filters.userId = users;
  const job = jobs(raw.job);
  if (job) filters.job = job;

  const sort = (raw.sort || 'name') as TimesheetReportSort;
  if (!(TIMESHEET_REPORT_SORTS as readonly string[]).includes(sort)) {
    throw new BadRequestException(`sort must be one of ${TIMESHEET_REPORT_SORTS.join(', ')}`);
  }
  const dir = raw.dir === 'asc' ? 'asc' : raw.dir === undefined || raw.dir === '' || raw.dir === 'desc' ? 'desc' : null;
  if (!dir) throw new BadRequestException('dir must be asc or desc');

  const page = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
  const pageSize =
    raw.pageSize === undefined || raw.pageSize === '' ? TIMESHEET_REPORT_DEFAULT_PAGE_SIZE : Number(raw.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > TIMESHEET_REPORT_MAX_PAGE_SIZE) {
    throw new BadRequestException(`pageSize must be 1–${TIMESHEET_REPORT_MAX_PAGE_SIZE}`);
  }

  const q = (raw.q ?? '').trim().slice(0, 200);
  return { from, to, filters, q, sort, dir, page, pageSize };
}

export function parseTimesheetEntriesQuery(raw: TimesheetEntriesQueryDto): TimesheetEntriesQuery {
  if (!raw.userId || !ID.test(raw.userId)) throw new BadRequestException('userId is required');
  const { from, to } = period(raw.from, raw.to);
  return { userId: raw.userId, from, to, job: jobs(raw.job) };
}
