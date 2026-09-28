import { Injectable, Logger } from '@nestjs/common';
import { CognitoAuthService } from '@bitcrm/shared';
import type {
  LoginResponse,
  LoginChallengeResponse,
  RefreshTokenResponse,
  ChangePasswordResponse,
} from '@bitcrm/types';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaResendDto } from './dto/mfa-resend.dto';
import { MfaService } from '../mfa/mfa.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly cognitoAuth: CognitoAuthService,
    private readonly mfa: MfaService,
  ) {}

  async login(
    dto: LoginDto,
  ): Promise<LoginResponse | LoginChallengeResponse> {
    const result = await this.cognitoAuth.login(dto.email, dto.password);
    // Cognito's own challenge (a first password) comes before any tokens exist.
    if ('challengeName' in result) return result;
    return this.mfa.gate(result);
  }

  /** The code texted by the second step, traded for the tokens it held back. */
  async verifyMfa(dto: MfaVerifyDto): Promise<LoginResponse> {
    return this.mfa.verify(dto.session, dto.code);
  }

  async resendMfa(dto: MfaResendDto): Promise<{ destination: string }> {
    return this.mfa.resend(dto.session);
  }

  async refreshToken(dto: RefreshTokenDto): Promise<RefreshTokenResponse> {
    return this.cognitoAuth.refreshToken(dto.refreshToken);
  }

  async changePassword(
    dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponse | LoginChallengeResponse> {
    // Setting a first password signs the person in — the same gate applies.
    const tokens = await this.cognitoAuth.respondToNewPasswordChallenge(
      dto.email,
      dto.newPassword,
      dto.session,
    );
    return this.mfa.gate(tokens);
  }

  async requestPasswordReset(
    dto: PasswordResetRequestDto,
  ): Promise<{ message: string }> {
    this.logger.log(`Password reset requested for ${dto.email}`);
    await this.cognitoAuth.forgotPassword(dto.email);
    // Always return the same response (no account enumeration).
    return { message: 'If the account exists, a reset code has been sent.' };
  }

  async confirmPasswordReset(
    dto: PasswordResetConfirmDto,
  ): Promise<{ message: string }> {
    await this.cognitoAuth.confirmForgotPassword(
      dto.email,
      dto.code,
      dto.newPassword,
    );
    this.logger.log(`Password reset confirmed for ${dto.email}`);
    return { message: 'Password has been reset.' };
  }
}
