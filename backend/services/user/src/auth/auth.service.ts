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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly cognitoAuth: CognitoAuthService) {}

  async login(
    dto: LoginDto,
  ): Promise<LoginResponse | LoginChallengeResponse> {
    return this.cognitoAuth.login(dto.email, dto.password);
  }

  async refreshToken(dto: RefreshTokenDto): Promise<RefreshTokenResponse> {
    return this.cognitoAuth.refreshToken(dto.refreshToken);
  }

  async changePassword(
    dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponse> {
    return this.cognitoAuth.respondToNewPasswordChallenge(
      dto.email,
      dto.newPassword,
      dto.session,
    );
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
