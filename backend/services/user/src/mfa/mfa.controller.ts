import { Body, Controller, Delete, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ConfirmMfaDto } from './dto/confirm-mfa.dto';
import { SetMfaDto } from './dto/set-mfa.dto';
import { MfaService } from './mfa.service';

/**
 * Switching two-step sign-in on and off. The caller's own switch lives under
 * `me` and needs nothing but a session; an admin's switch for someone else
 * lives under `:id` and needs `users.edit`.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller()
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('me/mfa/start')
  @ApiOperation({
    summary: 'Start switching on two-step sign-in',
    description:
      '**Guard:** Authenticated (any role) — only ever the caller. Texts a code to the phone on ' +
      'your profile; 400 when there is none.',
  })
  async start(@CurrentUser() user: JwtUser) {
    return { success: true, data: await this.mfa.startEnrollment(user.id) };
  }

  @Post('me/mfa/confirm')
  @ApiOperation({
    summary: 'Finish switching on two-step sign-in',
    description:
      '**Guard:** Authenticated (any role) — only ever the caller. The code from the text; the ' +
      'second step is on only once it comes back. 400 for a wrong or expired code.',
  })
  async confirm(@Body() dto: ConfirmMfaDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.mfa.confirmEnrollment(user.id, dto.code) };
  }

  @Delete('me/mfa')
  @ApiOperation({
    summary: 'Switch off two-step sign-in',
    description: '**Guard:** Authenticated (any role) — only ever the caller.',
  })
  async disable(@CurrentUser() user: JwtUser) {
    return { success: true, data: await this.mfa.disable(user.id) };
  }

  @Put(':id/mfa')
  @RequirePermission('users', 'edit')
  @ApiOperation({
    summary: "Switch someone's two-step sign-in on or off",
    description:
      '**Guard:** `users.edit` permission required. Off for anyone (a lost phone); on only for ' +
      'someone with a phone on their profile — their next sign-in texts it. 400 otherwise.',
  })
  async setForUser(@Param('id') id: string, @Body() dto: SetMfaDto) {
    return { success: true, data: await this.mfa.setByAdmin(id, dto.enabled) };
  }
}
