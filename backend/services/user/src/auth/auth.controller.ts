import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetConfirmDto } from './dto/password-reset-confirm.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaResendDto } from './dto/mfa-resend.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @ApiOperation({
    summary: 'Login with email and password',
    description: '**Guard:** Public (no auth required). Returns Cognito tokens (idToken, accessToken, refreshToken).',
  })
  async login(@Body() dto: LoginDto) {
    const data = await this.authService.login(dto);
    return { success: true, data };
  }

  @Post('mfa')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Finish a two-step sign-in with the texted code',
    description:
      '**Guard:** Public (no auth required). Answers an `SMS_MFA` login challenge: the right code ' +
      'returns the tokens the password step earned; a wrong one is 401, and five of them burn the ' +
      'challenge (sign in again). The challenge lasts five minutes.',
  })
  async verifyMfa(@Body() dto: MfaVerifyDto) {
    return { success: true, data: await this.authService.verifyMfa(dto) };
  }

  @Post('mfa/resend')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Text the two-step sign-in code again',
    description: '**Guard:** Public (no auth required). Same number, same challenge; 401 once it has expired.',
  })
  async resendMfa(@Body() dto: MfaResendDto) {
    return { success: true, data: await this.authService.resendMfa(dto) };
  }

  @Post('refresh')
  @Public()
  @ApiOperation({
    summary: 'Refresh access token',
    description: '**Guard:** Public (no auth required). Uses the refresh token to get new id/access tokens.',
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    const data = await this.authService.refreshToken(dto);
    return { success: true, data };
  }

  @Post('change-password')
  @Public()
  @ApiOperation({
    summary: 'Set new password (first login)',
    description: '**Guard:** Public (no auth required). Responds to NEW_PASSWORD_REQUIRED challenge from Cognito on first login.',
  })
  async changePassword(@Body() dto: ChangePasswordDto) {
    const data = await this.authService.changePassword(dto);
    return { success: true, data };
  }

  @Post('password-reset')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request a password reset code',
    description:
      '**Guard:** Public (no auth required). Emails a Cognito confirmation code. ' +
      'Always returns the same response to avoid account enumeration.',
  })
  async requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    const data = await this.authService.requestPasswordReset(dto);
    return { success: true, data };
  }

  @Post('password-reset/confirm')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm a password reset with the emailed code',
    description: '**Guard:** Public (no auth required). Sets a new password using the code.',
  })
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    const data = await this.authService.confirmPasswordReset(dto);
    return { success: true, data };
  }
}
