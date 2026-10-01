import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import {
  ITEMS_REPORT_ITEM_TYPES,
  ITEMS_REPORT_MAX_DAYS,
  ITEMS_REPORT_MAX_PAGE_SIZE,
  ITEMS_REPORT_SORTS,
  type ItemsReportFilters,
  type ItemsReportSort,
} from '@bitcrm/types';

/** A list parameter: `a,b` or repeated (`?type=a&type=b`) — both arrive here. */
type ListParam = string | string[];

/**
 * `GET /deals/report/items`, `/items/jobs` and `/items/export`. Every field
 * is declared so the global `whitelist` keeps it; the values are read by
 * `parseItemsReportQuery`, which owns the rules.
 */
export class ItemsReportQueryDto {
  @ApiPropertyOptional({ description: 'First day, YYYY-MM-DD (account calendar, America/New_York), on the job date.' })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: `Last day, inclusive. At most ${ITEMS_REPORT_MAX_DAYS} days after \`from\`.` })
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({
    description: `Item type: ${ITEMS_REPORT_ITEM_TYPES.map((t) => t.id).join(' | ')} — comma-separated or repeated.`,
  })
  @IsOptional()
  type?: ListParam;

  @ApiPropertyOptional({ description: 'Job type ids.' })
  @IsOptional()
  jobTypeId?: ListParam;

  @ApiPropertyOptional({ description: 'Price-book categories, by name; repeat the parameter for a name with a comma.' })
  @IsOptional()
  category?: ListParam;

  @ApiPropertyOptional({ description: 'Sold by: user ids.' })
  @IsOptional()
  soldBy?: ListParam;

  @ApiPropertyOptional({ description: 'Search: item name, model #, item number.' })
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ enum: ITEMS_REPORT_SORTS, description: 'Column to sort on. Default `number` (Workiz: newest items first).' })
  @IsOptional()
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Default `desc`.' })
  @IsOptional()
  dir?: string;

  @ApiPropertyOptional({ description: '1-based page. Default 1.' })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ description: `Rows per page, 1–${ITEMS_REPORT_MAX_PAGE_SIZE}. Default 50.` })
  @IsOptional()
  pageSize?: string;

  @ApiPropertyOptional({ description: "The jobs of one item only (`/items/jobs`): the row's `key`." })
  @IsOptional()
  item?: string;
}

export interface ItemsReportQuery {
  from: string;
  to: string;
  filters: ItemsReportFilters;
  q: string;
  sort: ItemsReportSort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  item?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;
const TYPES = new Set<string>(ITEMS_REPORT_ITEM_TYPES.map((t) => t.id));
const MAX_VALUES = 200;

function list(raw: ListParam | undefined, split = true): string[] {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => (split ? String(v).split(',') : [String(v)]));
  return [...new Set(parts.map((v) => v.trim()).filter(Boolean))];
}

function checked(values: string[], field: string, ok: (v: string) => boolean): string[] | undefined {
  if (values.length > MAX_VALUES) throw new BadRequestException(`${field}: at most ${MAX_VALUES} values`);
  for (const v of values) if (!ok(v)) throw new BadRequestException(`${field}: "${v.slice(0, 60)}" is not accepted`);
  return values.length ? values : undefined;
}

function day(value: string | undefined, field: string): string {
  if (!value || !DAY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`${field} must be a YYYY-MM-DD date`);
  }
  return value;
}

/** Reads and checks a report query. */
export function parseItemsReportQuery(raw: ItemsReportQueryDto): ItemsReportQuery {
  const from = day(raw.from, 'from');
  const to = raw.to ? day(raw.to, 'to') : from;
  if (to < from) throw new BadRequestException('to is before from');
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > ITEMS_REPORT_MAX_DAYS) throw new BadRequestException(`The period is at most ${ITEMS_REPORT_MAX_DAYS} days`);

  const filters: ItemsReportFilters = {};
  const type = checked(
    list(raw.type).map((v) => v.toLowerCase()),
    'type',
    (v) => TYPES.has(v),
  );
  if (type) filters.type = type;
  const jobTypeId = checked(list(raw.jobTypeId), 'jobTypeId', (v) => ID.test(v));
  if (jobTypeId) filters.jobTypeId = jobTypeId;
  // A category name may hold a comma ("Locks, Keys"): a repeated parameter keeps it whole.
  const category = checked(list(raw.category, !Array.isArray(raw.category)), 'category', (v) => v.length <= 200);
  if (category) filters.category = category;
  const soldBy = checked(list(raw.soldBy), 'soldBy', (v) => ID.test(v));
  if (soldBy) filters.soldBy = soldBy;

  const sort = (raw.sort || 'number') as ItemsReportSort;
  if (!(ITEMS_REPORT_SORTS as readonly string[]).includes(sort)) throw new BadRequestException(`sort: unknown column "${raw.sort}"`);
  const dir = raw.dir === 'asc' ? 'asc' : raw.dir === undefined || raw.dir === '' || raw.dir === 'desc' ? 'desc' : null;
  if (!dir) throw new BadRequestException('dir must be asc or desc');

  const page = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
  const pageSize = raw.pageSize === undefined || raw.pageSize === '' ? 50 : Number(raw.pageSize);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ITEMS_REPORT_MAX_PAGE_SIZE) {
    throw new BadRequestException(`pageSize must be 1–${ITEMS_REPORT_MAX_PAGE_SIZE}`);
  }

  const item = raw.item?.trim();
  if (item !== undefined && item !== '' && item.length > 300) throw new BadRequestException('item is too long');

  const q = (raw.q ?? '').trim().slice(0, 200);
  return { from, to, filters, q, sort, dir, page, pageSize, ...(item && { item }) };
}
