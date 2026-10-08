import { Inject, Injectable, Logger } from '@nestjs/common';
import { TELEPHONY_CONFIG, type TelephonyConfig } from './telephony.config';

const MESSAGING_SERVICE_URL = process.env.MESSAGING_SERVICE_URL || 'http://localhost:4007';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** The pill does not need to follow a settings change within the second. */
const CACHE_TTL_MS = 60_000;

/**
 * The workspace's main number — the grey pill beside Workiz's "Workiz Phone"
 * heading on the call log ("(203) 403-6303").
 *
 * It is the messaging default sender (Settings → Messaging → Default number,
 * Workiz's `snd_number`), which messaging keeps behind `settings.view`; this
 * reads just that number over messaging's internal route so `GET
 * /telephony/config` can hand it to every user. Without one set, the
 * workspace caller id (`TWILIO_CALLER_ID`) stands in; with neither, null.
 * Messaging being down serves the last answer it gave — never an error, the
 * pill is decoration.
 */
@Injectable()
export class MainNumberService {
  private readonly logger = new Logger(MainNumberService.name);
  private cache: { value: string | null; expiresAt: number } | null = null;

  constructor(@Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig) {}

  async mainNumber(): Promise<string | null> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    try {
      const res = await fetch(`${MESSAGING_SERVICE_URL}/api/messaging/settings/internal/main-number`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) throw new Error(`messaging returned ${res.status}`);
      const body = (await res.json()) as { data?: { mainNumber?: string | null } };
      const value = body.data?.mainNumber || this.config.callerId || null;
      this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    } catch (error) {
      this.logger.warn(`main number lookup failed: ${error instanceof Error ? error.message : error}`);
      return this.cache?.value ?? (this.config.callerId || null);
    }
  }
}
