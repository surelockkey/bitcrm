import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_TIMEZONE, type MessagingSettings } from '@bitcrm/types';
import { MessagingSettingsRepository } from './messaging-settings.repository';
import { type UpdateMessagingSettingsDto } from './dto/update-messaging-settings.dto';
import { isValidTimezone } from '../templates/date-format';

/**
 * What `GET /settings` answers before anyone has saved: the company zone
 * and the two auto-replies Twilio's own keyword handling would otherwise
 * leave empty. The HELP text has no company name or phone yet — the owner
 * fills those in (§4.8).
 */
export const DEFAULT_MESSAGING_SETTINGS: Readonly<MessagingSettings> = Object.freeze({
  timezone: DEFAULT_TIMEZONE,
  stopReplyText:
    'You have been unsubscribed and will not receive any more messages from us. Reply START to opt back in.',
  helpReplyText: 'Reply STOP to unsubscribe. Msg & data rates may apply.',
});

/** Text fields where `""` on PUT means "clear" (the repository drops empty strings). */
const CLEARABLE = [
  'defaultSenderNumber', 'smsFormat', 'smsPre', 'signature', 'onMyWayMsg', 'lateMsg',
  'confirmLinkBaseUrl', 'infoLinkBaseUrl', 'stopReplyText', 'helpReplyText',
  'companyName', 'companyPhone', 'companyEmail', 'timezone',
] as const;

@Injectable()
export class MessagingSettingsService {
  private readonly logger = new Logger(MessagingSettingsService.name);

  constructor(private readonly repository: MessagingSettingsRepository) {}

  /** Stored document over the defaults; never null. */
  async get(): Promise<MessagingSettings> {
    const stored = await this.repository.get();
    return { ...DEFAULT_MESSAGING_SETTINGS, ...(stored ?? {}) };
  }

  /**
   * Merge `dto` over the stored document and write it back whole (the
   * repository is a single-item Put). Zones are checked here because a
   * class-validator rule cannot ask Intl; an unknown zone would silently
   * fall back to New York in every rendered date.
   */
  async update(dto: UpdateMessagingSettingsDto, caller: { id: string }): Promise<MessagingSettings> {
    if (dto.timezone && !isValidTimezone(dto.timezone)) {
      throw new BadRequestException(`Unknown timezone "${dto.timezone}"`);
    }
    if (dto.quietHours && !isValidTimezone(dto.quietHours.timezone)) {
      throw new BadRequestException(`Unknown quiet-hours timezone "${dto.quietHours.timezone}"`);
    }

    const current = (await this.repository.get()) ?? {};
    const next: MessagingSettings = { ...current };
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      if (value === '' && (CLEARABLE as readonly string[]).includes(key)) {
        delete (next as Record<string, unknown>)[key];
        continue;
      }
      (next as Record<string, unknown>)[key] = value;
    }

    const saved = await this.repository.put(next, caller.id);
    this.logger.log(`Messaging settings updated by ${caller.id}: ${Object.keys(dto).join(', ')}`);
    return { ...DEFAULT_MESSAGING_SETTINGS, ...saved };
  }
}
