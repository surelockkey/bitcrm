import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { MfaSetupRequest } from '@bitcrm/types';

/** The phone to text, for an `MFA_SETUP` challenge: the account requires 2FA and the person had none. */
export class MfaSetupDto implements MfaSetupRequest {
  @ApiProperty({ description: 'The `session` of the MFA_SETUP challenge the password step answered with.' })
  @IsString()
  session!: string;

  @ApiProperty({ example: '+15412830739', description: 'Any format — stored E.164 once its code comes back.' })
  @IsString()
  @MinLength(7)
  phone!: string;
}
