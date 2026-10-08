import { IsOptional, IsString, IsEnum, IsInt, IsIn, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobSuperStatus, DealPriority, DealStatus, ClientType } from '@bitcrm/types';

export class ListDealsQueryDto {
  @ApiPropertyOptional({ enum: JobSuperStatus })
  @IsOptional()
  @IsEnum(JobSuperStatus)
  superStatus?: JobSuperStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  techId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dispatcherId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Catalog job-type id.' })
  @IsOptional()
  @IsString()
  jobTypeId?: string;

  @ApiPropertyOptional({ description: 'Catalog job-source id.' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Company (billing business profile) id.' })
  @IsOptional()
  @IsString()
  businessProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serviceArea?: string;

  @ApiPropertyOptional({ enum: ClientType })
  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;

  @ApiPropertyOptional({ enum: DealStatus })
  @IsOptional()
  @IsEnum(DealStatus)
  status?: DealStatus;

  @ApiPropertyOptional({ enum: DealPriority })
  @IsOptional()
  @IsEnum(DealPriority)
  priority?: DealPriority;

  @ApiPropertyOptional({
    description: 'Comma-separated job-tag ids; a deal must carry all of them — or any of them with `tagMatch=any`.',
  })
  @IsOptional()
  @IsString()
  tagIds?: string;

  @ApiPropertyOptional({
    enum: ['all', 'any'],
    description: 'How `tagIds` combine: `all` (the default) or `any` (Workiz "Filter results": OR inside a group).',
  })
  @IsOptional()
  @IsIn(['all', 'any'])
  tagMatch?: 'all' | 'any';

  // ---- Workiz "Filter results": several picks in a group are ANY-of -------

  @ApiPropertyOptional({
    example: 'tech-1,tech-2',
    description:
      'Comma-separated technician ids: jobs with ANY of them assigned (at most 50). Narrows on top of `techId` and ' +
      'of an `assigned_only` caller’s own jobs, never widens them.',
  })
  @IsOptional()
  @IsString()
  techIds?: string;

  @ApiPropertyOptional({
    example: 'jt-1,jt-2',
    description: 'Comma-separated catalog job-type ids, any-of (at most 50). With `jobTypeId` the two are one group.',
  })
  @IsOptional()
  @IsString()
  jobTypeIds?: string;

  @ApiPropertyOptional({
    example: 'Dallas,Fort Worth',
    description: 'Comma-separated service-area NAMES (as `serviceArea`), any-of (at most 50). With `serviceArea` one group.',
  })
  @IsOptional()
  @IsString()
  serviceAreas?: string;

  @ApiPropertyOptional({
    example: 'bp-default,bp-2',
    description: 'Comma-separated company (business profile) ids, any-of (at most 50). With `businessProfileId` one group.',
  })
  @IsOptional()
  @IsString()
  businessProfileIds?: string;

  @ApiPropertyOptional({ description: 'Deal-number search, e.g. "1042" or "#1042".' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'dustin',
    description:
      'The jobs list\'s Search box (Workiz): a case-insensitive piece of the client\'s name (the "Just here" name on ' +
      'the job too), the Job ID ("5TU7" finds 5TU7ZA), phone digits in any format ("469 396", 4+ digits; only for a ' +
      'caller with `contacts.view_numbers`), the street / city / state / zip, the job type, the job name, an email or ' +
      'the client\'s company. Never the technician or the tags. Applied inside `superStatus` / `unscheduled` and every ' +
      'other filter, fully paged; `/deals/counts` takes it too. Jobs written before the search attributes existed ' +
      'match only after `backfill:deal-search`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Billing: only jobs with at least one line item and no invoice yet.',
  })
  @IsOptional()
  @IsIn(['true', 'false', true, false])
  needsInvoice?: string | boolean;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description:
      'Workiz "Show unpaid jobs": only jobs with money still owed — a total above $0 and either above ' +
      "billing's `amountPaid` or, before any payment event, not marked paid. Narrows `/deals/counts` the same way.",
  })
  @IsOptional()
  @IsIn(['true', 'false', true, false])
  unpaid?: string | boolean;

  // ---- the schedule window (StatusScheduleIndex) --------------------------

  @ApiPropertyOptional({
    example: '2026-09-21',
    description:
      'First visit day of the window (YYYY-MM-DD, inclusive). With `scheduledTo` at most 31 days; alone = that one day. ' +
      'Reads the schedule index in visit order; without `superStatus` every status is merged.',
  })
  @IsOptional()
  @IsString()
  scheduledFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-27', description: 'Last visit day of the window (inclusive).' })
  @IsOptional()
  @IsString()
  scheduledTo?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Only jobs with no visit date. Without `superStatus` covers the open statuses.',
  })
  @IsOptional()
  @IsIn(['true', 'false', true, false])
  unscheduled?: string | boolean;

  @ApiPropertyOptional({
    enum: ['schedule', 'created'],
    description: '`schedule` = visit date, soonest first (undated last); `created` = the default, newest first.',
  })
  @IsOptional()
  @IsIn(['schedule', 'created'])
  sort?: 'schedule' | 'created';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  // ---- the report windows: "By: Job created" / "By: Job closed" ----------

  @ApiPropertyOptional({
    example: '2026-09-01',
    description:
      'First creation day of the window (YYYY-MM-DD, inclusive), with `createdTo` at most 92 days; alone = that day. ' +
      'Reads the status index by creation time, newest first; without `superStatus` every status is merged. ' +
      'Cannot be combined with a scheduled or closed window.',
  })
  @IsOptional()
  @IsString()
  createdFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsString()
  createdTo?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description:
      'First closing day of the window (YYYY-MM-DD, inclusive), with `closedTo` at most 92 days. Reads the closed ' +
      'index (Done / Canceled only), newest first; `superStatus` narrows it.',
  })
  @IsOptional()
  @IsString()
  closedFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsString()
  closedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subStatusId?: string;

  @ApiPropertyOptional({ description: "The client's company (CRM company id)." })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Who created the job (user id).' })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({ example: '08:00', description: 'Earliest visit start (HH:MM). Undated / all-day visits never match.' })
  @IsOptional()
  @IsString()
  hourFrom?: string;

  @ApiPropertyOptional({ example: '12:00', description: 'Latest visit start (HH:MM).' })
  @IsOptional()
  @IsString()
  hourTo?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
