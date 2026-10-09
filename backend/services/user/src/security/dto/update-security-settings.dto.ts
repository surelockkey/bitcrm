import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { UpdateSecuritySettingsRequest } from '@bitcrm/types';

/** The Security Center's switches — any subset; the rest keep their value. */
export class UpdateSecuritySettingsDto implements UpdateSecuritySettingsRequest {
  @ApiPropertyOptional({
    description:
      'Workiz "Require Two-factor authentication (2FA)": every sign-in needs the texted code, whatever the ' +
      "person's own switch says; someone with no phone sets one up on the way in. Subcontractors are exempt.",
  })
  @IsOptional()
  @IsBoolean()
  requireMfa?: boolean;

  @ApiPropertyOptional({
    description: 'Workiz "Login sending options": the sign-in code may also be sent to the account\'s email, on request.',
  })
  @IsOptional()
  @IsBoolean()
  loginCodeByEmail?: boolean;

  @ApiPropertyOptional({
    description: 'Workiz "OTP sending options": in-app checks (e.g. before an export) may send their code by email.',
  })
  @IsOptional()
  @IsBoolean()
  otpByEmail?: boolean;
}
