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
import { MfaSetupDto } from './dto/mfa-setup.dto';
import { MfaEmailDto } from './dto/mfa-email.dto';

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

  @Post('mfa/setup')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set up the phone for a sign-in the account requires two-factor authentication for',
    description:
      '**Guard:** Public (no auth required). Answers an `MFA_SETUP` login challenge (Security Center ' +
      '"Require Two-factor authentication" is on and the person had no phone): texts a code to the given ' +
      'number and names it masked. 409 when a teammate already holds the number, 400 for a challenge that ' +
      'already has a phone. `POST /auth/mfa` with the code then saves the phone, switches the second step ' +
      'on and signs the person in. Another number may be given before that.',
  })
  async setupMfa(@Body() dto: MfaSetupDto) {
    return { success: true, data: await this.authService.setupMfa(dto) };
  }

  @Post('mfa/email')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: "Send the two-step sign-in code to the account's email instead",
    description:
      '**Guard:** Public (no auth required). Security Center "Login sending options": a six-digit code to ' +
      'the email on the profile, good for five minutes beside the texted one; `POST /auth/mfa` takes ' +
      'either. 400 when the account does not allow it, 503 when the server cannot send email, 401 once the ' +
      'challenge has expired.',
  })
  async emailMfaCode(@Body() dto: MfaEmailDto) {
    return { success: true, data: await this.authService.emailMfaCode(dto) };
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
