import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, ValidateIf } from 'class-validator';
import { ONLINE_PAYMENT_METHODS, type OnlinePaymentMethod } from '@bitcrm/types';

/** Workiz "Let client pay with", chosen on the document when it is sent. */
export class AllowedMethodsDto {
  @ApiProperty({
    isArray: true,
    enum: ONLINE_PAYMENT_METHODS as unknown as string[],
    nullable: true,
    description: '`null` clears the override, so the account settings decide.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(ONLINE_PAYMENT_METHODS as unknown as string[], { each: true })
  methods!: OnlinePaymentMethod[] | null;
}
