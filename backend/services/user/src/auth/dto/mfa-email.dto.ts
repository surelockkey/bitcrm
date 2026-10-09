import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { MfaEmailCodeRequest } from '@bitcrm/types';

/** Send this challenge's sign-in code to the account's email (Security Center "Login sending options"). */
export class MfaEmailDto implements MfaEmailCodeRequest {
  @ApiProperty({ description: 'The `session` of the SMS_MFA challenge the password step answered with.' })
  @IsString()
  session!: string;
}
