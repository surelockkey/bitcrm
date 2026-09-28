import { IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { type MfaVerifyRequest } from '@bitcrm/types';

export class MfaVerifyDto implements MfaVerifyRequest {
  @ApiProperty({ description: 'The `session` of the `SMS_MFA` challenge the login answered with.' })
  @IsString()
  @MinLength(1)
  session!: string;

  @ApiProperty({ example: '123456', description: 'The code texted to the account\'s phone.' })
  @IsString()
  @Matches(/^\d{4,10}$/, { message: 'code must be the digits from the text' })
  code!: string;
}
