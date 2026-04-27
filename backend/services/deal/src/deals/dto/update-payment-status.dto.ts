import { IsString, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePaymentStatusDto {
  @ApiProperty({ example: 'payment-uuid' })
  @IsString()
  paymentId!: string;

  @ApiProperty({ example: 250.0 })
  @IsNumber()
  amount!: number;

  @ApiProperty({ example: '2026-04-20T15:30:00.000Z' })
  @IsDateString()
  paidAt!: string;
}
