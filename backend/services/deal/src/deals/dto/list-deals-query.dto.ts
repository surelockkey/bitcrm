import { IsOptional, IsString, IsEnum, IsInt, IsIn, Min, Max } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Comma-separated job-tag ids; a deal must carry all of them.' })
  @IsOptional()
  @IsString()
  tagIds?: string;

  @ApiPropertyOptional({ description: 'Deal-number search, e.g. "1042" or "#1042".' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Billing: only jobs with at least one line item and no invoice yet.',
  })
  @IsOptional()
  @IsIn(['true', 'false', true, false])
  needsInvoice?: string | boolean;

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
