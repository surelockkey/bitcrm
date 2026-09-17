import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaymentTerms } from '@bitcrm/types';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class UpdateInvoiceDto {
  @ApiPropertyOptional({ example: '2026-09-16' })
  @IsOptional()
  @Matches(YMD, { message: 'invoiceDate must be YYYY-MM-DD' })
  invoiceDate?: string;

  @ApiPropertyOptional({ enum: PaymentTerms, description: 'Changing the terms recomputes dueDate unless dueDate is sent too.' })
  @IsOptional()
  @IsEnum(PaymentTerms)
  paymentTerms?: PaymentTerms;

  @ApiPropertyOptional({ example: '2026-10-16' })
  @IsOptional()
  @Matches(YMD, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true, description: '`null` → auto-apply rules / default template.' })
  @IsOptional()
  @IsString()
  templateId?: string | null;
}
