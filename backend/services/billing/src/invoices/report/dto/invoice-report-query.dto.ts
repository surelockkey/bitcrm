import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  AGING_BUCKETS,
  AGING_SORTS,
  INVOICE_DAYS_DUE,
  INVOICE_REPORT_STATUSES,
  type AgingBucket,
  type AgingSort,
  type InvoiceDaysDue,
  type InvoiceReportStatus,
} from '@bitcrm/types';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { REPORT_DAY, toList } from '../../../common/dto/report-query.util';

/** Workiz's created-date window: business days (America/New_York), inclusive. */
export class InvoiceReportWindowDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Created on or after (business day). Both absent = All time.' })
  @IsOptional()
  @Matches(REPORT_DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-27', description: 'Created on or before (business day), inclusive.' })
  @IsOptional()
  @Matches(REPORT_DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/** The Invoices report's list / count / export query — Workiz's "Filter results" + search. */
export class InvoiceReportQueryDto extends InvoiceReportWindowDto {
  @ApiPropertyOptional({ type: [String], enum: INVOICE_REPORT_STATUSES, example: 'due,overdue', description: 'Status group, OR inside.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(INVOICE_REPORT_STATUSES as unknown as string[], { each: true })
  statuses?: InvoiceReportStatus[];

  @ApiPropertyOptional({ type: [String], enum: INVOICE_DAYS_DUE, example: '0_30,30_60', description: 'Days due group (open invoices only), OR inside.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(INVOICE_DAYS_DUE as unknown as string[], { each: true })
  daysDue?: InvoiceDaysDue[];

  @ApiPropertyOptional({ type: [String], enum: ['sent', 'unsent'], description: 'Sent group; both = no filter.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['sent', 'unsent'], { each: true })
  sent?: Array<'sent' | 'unsent'>;

  @ApiPropertyOptional({ description: 'Invoice number or name.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** Aging invoices: the active card, the sort, a page. */
export class AgingQueryDto {
  @ApiPropertyOptional({ enum: AGING_BUCKETS, description: 'The active card. Default `all` (every unpaid invoice).' })
  @IsOptional()
  @IsIn(AGING_BUCKETS as unknown as string[])
  bucket?: AgingBucket;

  @ApiPropertyOptional({ enum: AGING_SORTS, description: 'Default `daysLate` (oldest debt first).' })
  @IsOptional()
  @IsIn(AGING_SORTS as unknown as string[])
  sort?: AgingSort;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
