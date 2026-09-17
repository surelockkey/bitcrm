import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InvoiceLinkDto {
  @ApiProperty({ type: String, nullable: true, description: 'The invoice id (=== dealId), or null to unlink.' })
  @IsOptional()
  @IsString()
  invoiceId!: string | null;
}
