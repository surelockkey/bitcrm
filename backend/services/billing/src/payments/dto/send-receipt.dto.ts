import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, ValidateBy, ValidateIf, isEmail, type ValidationArguments } from 'class-validator';
import { PAYMENT_RECEIPT_CHANNELS, type PaymentReceiptChannel } from '@bitcrm/types';

/** E.164, as messaging takes a number to text. */
export const RECEIPT_E164 = /^\+[1-9]\d{6,14}$/;

/** The address fits the channel: an email for `email`, an E.164 number for `sms` — and never without a channel. */
export function receiptAddressFits(to: unknown, channel: unknown): boolean {
  if (typeof to !== 'string') return false;
  const value = to.trim();
  if (channel === 'email') return isEmail(value);
  if (channel === 'sms') return RECEIPT_E164.test(value);
  return false;
}

/**
 * `POST /payments/:paymentId/receipt` — every field optional: no body sends
 * today's receipt (the client's first number, else their first email).
 */
export class SendReceiptDto {
  @ApiPropertyOptional({
    enum: PAYMENT_RECEIPT_CHANNELS,
    example: 'email',
    description: 'Required with `to`. Alone: the client’s own address of that kind.',
  })
  @ValidateIf((o: SendReceiptDto) => o.channel !== undefined || o.to !== undefined)
  @IsIn(PAYMENT_RECEIPT_CHANNELS as unknown as string[], { message: 'channel must be email or sms' })
  channel?: PaymentReceiptChannel;

  @ApiPropertyOptional({
    example: 'walter@example.com',
    description:
      'The address typed on the phone (Workiz "Send a receipt?" Email field): a valid email for `email`, an E.164 ' +
      'number (+18605550100) for `sms`. It need not be one the client has.',
  })
  @IsOptional()
  @ValidateBy({
    name: 'receiptAddress',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        receiptAddressFits(value, (args?.object as SendReceiptDto | undefined)?.channel),
      defaultMessage: (args?: ValidationArguments) => {
        const channel = (args?.object as SendReceiptDto | undefined)?.channel;
        if (channel === 'email') return 'to must be an email address';
        if (channel === 'sms') return 'to must be an E.164 phone number, like +18605550100';
        return 'to needs a channel: email or sms';
      },
    },
  })
  to?: string;
}
