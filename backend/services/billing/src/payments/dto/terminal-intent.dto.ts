import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/** One card payment on a staff phone (Stripe Terminal / Tap to Pay). */
export class TerminalIntentDto {
  @ApiProperty({
    example: 120.5,
    description: 'Dollars toward the balance (invoice) or the deposit (estimate). Refused above it — never capped.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({
    example: 18,
    description: 'Dollars on top, chosen on the phone BEFORE the tap. Charged with the amount; never toward the balance.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tipAmount?: number;

  @ApiProperty({
    example: '0b9c6d2e-4f1a-4c3b-9d8e-7a6b5c4d3e2f',
    description:
      'A UUID the phone makes once per payment attempt. It becomes the payment id and the Stripe idempotency ' +
      'key: a retry with the same id gets the same payment and PaymentIntent back.',
  })
  @IsUUID()
  attemptId!: string;
}
