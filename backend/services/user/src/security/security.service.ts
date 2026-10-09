import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import type { SecuritySettings, SecuritySettingsAuditEntry, UpdateSecuritySettingsRequest } from '@bitcrm/types';
import { EmailCodeSender } from './email-code.sender';
import { SecuritySettingsRepository } from './security-settings.repository';

type Switches = Pick<SecuritySettings, 'requireMfa' | 'loginCodeByEmail' | 'otpByEmail'>;

/**
 * Settings → Security Center: the account's switches. "Require Two-factor
 * authentication" is read by the sign-in gate (`MfaService.gate`) on every
 * sign-in; the two email switches say whether a code may go by email — and
 * cannot go on while the server has no sender for one, so the page never
 * promises what the sign-in cannot do. Every change is logged with who made
 * it and what it was before.
 */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    private readonly repository: SecuritySettingsRepository,
    @Optional() private readonly emailCodes?: EmailCodeSender,
  ) {}

  getSettings(): Promise<SecuritySettings> {
    return this.repository.get();
  }

  async updateSettings(dto: UpdateSecuritySettingsRequest, actorId: string): Promise<SecuritySettings> {
    if ((dto.loginCodeByEmail === true || dto.otpByEmail === true) && !this.emailCodes?.available) {
      throw new BadRequestException(
        'Codes by email are not set up on this server (MESSAGING_EMAIL_FROM). The switch stays off.',
      );
    }
    const current = await this.repository.get();
    const before = switchesOf(current);
    const after: Switches = {
      requireMfa: dto.requireMfa ?? before.requireMfa,
      loginCodeByEmail: dto.loginCodeByEmail ?? before.loginCodeByEmail,
      otpByEmail: dto.otpByEmail ?? before.otpByEmail,
    };
    if (sameSwitches(before, after)) return current;

    const timestamp = new Date().toISOString();
    const next: SecuritySettings = { ...after, updatedAt: timestamp, updatedBy: actorId };
    await this.repository.put(next);
    await this.repository.recordChange({ actorId, timestamp, before, after });
    this.logger.log(`Security settings changed by ${actorId}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    return next;
  }

  listAudit(limit: number): Promise<SecuritySettingsAuditEntry[]> {
    return this.repository.listChanges(limit);
  }
}

function switchesOf(settings: SecuritySettings): Switches {
  return {
    requireMfa: settings.requireMfa,
    loginCodeByEmail: settings.loginCodeByEmail,
    otpByEmail: settings.otpByEmail,
  };
}

function sameSwitches(a: Switches, b: Switches): boolean {
  return a.requireMfa === b.requireMfa && a.loginCodeByEmail === b.loginCodeByEmail && a.otpByEmail === b.otpByEmail;
}
