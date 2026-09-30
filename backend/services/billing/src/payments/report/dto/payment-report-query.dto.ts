import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** `a,b` or `?x=a&x=b` → `['a', 'b']`. */
const toList = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map((v) => String(v).trim()).filter(Boolean);
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Payments report's query — Workiz's date window, its three filter
 * groups (OR inside a group, AND between groups) and the search box.
 */
export class PaymentReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'First business day (America/New_York), inclusive. Both ends absent = All time.',
  })
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-27', description: 'Last business day, inclusive.' })
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional({
    type: [String],
    example: 'charge,cash',
    description: 'Workiz payment types (`refund` selects refund + refund_offline). Comma list or repeated.',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  types?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Technician (user) ids — the job’s lead technician.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  technicianIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Service area ids.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  serviceAreaIds?: string[];

  @ApiPropertyOptional({ description: 'Job number, confirmation code, card last 4 or an amount.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], description: 'Payment date order. Default `desc` (Workiz).' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';
}
