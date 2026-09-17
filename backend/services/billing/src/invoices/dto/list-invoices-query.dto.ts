import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { INVOICE_STATUSES, type InvoiceStatus } from '@bitcrm/types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES as unknown as string[])
  status?: InvoiceStatus;

  @ApiPropertyOptional({ description: 'Only invoices never marked sent.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unsent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dealId?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'createdAt ≥ (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(YMD)
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'createdAt ≤ (YYYY-MM-DD, inclusive)' })
  @IsOptional()
  @Matches(YMD)
  to?: string;
}
