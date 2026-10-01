import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { PaymentTerms, type DocumentVisibility } from '@bitcrm/types';
import { DiscountDto } from '../../common/dto/discount.dto';

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

  @ApiPropertyOptional({
    nullable: true,
    description:
      "CLIENT invoices only (422 on a job invoice — its tax is the job's). Catalog tax rate; name + effective percent are snapshotted (source `manual`). `null` = no tax.",
  })
  @IsOptional()
  @IsString()
  taxRateId?: string | null;

  @ApiPropertyOptional({ description: 'Workiz Send panel "Request signature": the portal asks the client to sign before paying.' })
  @IsOptional()
  @IsBoolean()
  requestSignature?: boolean;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    example: { quantity: false, unitPrice: false },
    description: 'Workiz Send panel "Advanced": visibility keys (quantity, unitPrice, lineAmount, description, sku, …) the client sees. `null` = the template’s own.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  display?: Partial<DocumentVisibility> | null;

  @ApiPropertyOptional({ type: DiscountDto, nullable: true, description: 'CLIENT invoices only (422 on a job invoice).' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountDto)
  discount?: DiscountDto | null;
}
