import { Injectable } from '@nestjs/common';
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

@Injectable()
export class AuthService {
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
}
