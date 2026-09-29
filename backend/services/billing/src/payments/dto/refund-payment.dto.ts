import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({ example: 40, description: 'Dollars. Omit to refund everything still refundable.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ApiPropertyOptional({ example: 'requested_by_customer', description: 'Shown on the refund receipt.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ example: true, description: 'Reserved — billing does not send client email itself.' })
  @IsOptional()
  @IsBoolean()
  sendReceipt?: boolean;
}
