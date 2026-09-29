import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ONLINE_PAYMENT_METHODS, type OnlinePaymentMethod } from '@bitcrm/types';

export class PortalPayDto {
  @ApiProperty({ example: 120.5, description: 'Dollars. Re-clamped server-side to 0 < x ≤ balance.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiProperty({ enum: ONLINE_PAYMENT_METHODS as unknown as string[], example: 'card' })
  @IsIn(ONLINE_PAYMENT_METHODS as unknown as string[])
  method!: OnlinePaymentMethod;

  @ApiPropertyOptional({
    example: '/<token>/invoice/<id>',
    description:
      'The portal path to return to after the payment method’s own redirect. Must be a path under ' +
      'this token; anything else falls back to `/<token>`. `?payment=&invoice=` are appended.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  returnPath?: string;
}
