import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { UpdateSecuritySettingsDto } from './dto/update-security-settings.dto';
import { SecurityService } from './security.service';

const AUDIT_DEFAULT = 50;
const AUDIT_MAX = 200;

/**
 * Settings → Security Center. Reading the row needs only a session: the
 * profile page shows "Required by your account" on everyone's two-factor
 * row, and there is nothing secret in three switches. Changing it is
 * `settings.edit` — Super Admin and Admin in the seeds.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Controller('security-settings')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get()
  @ApiOperation({
    summary: "The account's security settings (Security Center)",
    description:
      '**Guard:** Authenticated (any role). Whether two-factor authentication is required of everyone, and ' +
      'whether sign-in / in-app codes may go by email. The defaults — nothing required, nothing by email — ' +
      'until the page is saved.',
  })
  async get() {
    return { success: true, data: await this.security.getSettings() };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: "Change the account's security settings",
    description:
      '**Guard:** `settings.edit` permission required. Any subset of the switches. Turning an email switch on ' +
      'is refused (400) while the server has no sender for codes (`MESSAGING_EMAIL_FROM`). Every change is ' +
      'logged with who made it.',
  })
  async update(@Body() dto: UpdateSecuritySettingsDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.security.updateSettings(dto, user.id) };
  }

  @Get('audit')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Who changed the security settings, and what from',
    description: '**Guard:** `settings.edit` permission required. Newest first; `limit` up to 200, default 50.',
  })
  async audit(@Query('limit') limit?: string) {
    const n = Number(limit);
    const size = Number.isInteger(n) && n > 0 ? Math.min(n, AUDIT_MAX) : AUDIT_DEFAULT;
    return { success: true, data: await this.security.listAudit(size) };
  }
}
