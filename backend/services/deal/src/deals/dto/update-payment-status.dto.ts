import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What billing-service reports after a change to an invoice's payment ledger.
 *
 * Billing owns the ledger; the job keeps only this denormalised flag for the
 * job board. Every field is ASSERTED from the ledger's current sum, never
 * added to what is stored — a reversal or a refund arrives here as a LOWER
 * `amountPaid` and a status that has gone backwards, and that is correct.
 */
export class UpdatePaymentStatusDto {
  @ApiProperty({ enum: ['unpaid', 'partial', 'paid'], example: 'partial' })
  @IsIn(['unpaid', 'partial', 'paid'])
  paymentStatus!: 'unpaid' | 'partial' | 'paid';

  @ApiProperty({ example: 60, description: 'Dollars collected so far: settled payments less refunds.' })
  @IsNumber()
  @Min(0)
  amountPaid!: number;

  @ApiPropertyOptional({
    example: 250,
    description: "The invoice total. Written to the job's `actualTotal` — which is the amount BILLED, never the amount paid.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  invoiceTotal?: number;

  @ApiPropertyOptional({ example: '2026-04-20T15:30:00.000Z' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @ApiPropertyOptional({ example: 'payment-uuid', description: 'The payment that triggered this update.' })
  @IsOptional()
  @IsString()
  paymentId?: string;
}
