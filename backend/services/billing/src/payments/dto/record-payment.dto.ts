import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PAYMENT_METHODS, type PaymentMethod } from '@bitcrm/types';
import { OFFLINE_PAYMENT_METHODS } from '../payments.service';

/** Money staff took themselves — cash, a cheque, a card run in person. */
export class RecordPaymentDto {
  @ApiProperty({ example: 120.5, description: 'Dollars. Refused above the invoice balance.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: OFFLINE_PAYMENT_METHODS as unknown as string[], example: 'cash' })
  @IsIn(OFFLINE_PAYMENT_METHODS as unknown as string[])
  method!: PaymentMethod;

  @ApiPropertyOptional({ example: 'Cheque #1041', description: "Cheque number, confirmation code, the tech's note." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional({ example: 'Paid to Mike on site' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiPropertyOptional({ example: '2026-09-22T15:30:00.000Z', description: 'When it was actually taken. Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  takenAt?: string;
}

export const ALL_PAYMENT_METHODS = PAYMENT_METHODS;
