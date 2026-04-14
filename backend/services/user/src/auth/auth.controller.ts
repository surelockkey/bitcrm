import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

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
}
