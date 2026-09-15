import { Inject, Injectable, Logger } from '@nestjs/common';
import { MessagingSettingsRepository } from '../settings/messaging-settings.repository';
import { EMAIL_CONFIG, type EmailConfig } from './email.config';
import { buildReplyAddress } from './reply-token';

export interface ResolvedEmailSender {
  /** Bare address the mail is sent from (must be on the verified domain). */
  from: string;
  /** `"Sure Lock & Key" <office@example.com>` — what the recipient sees. */
  fromHeader: string;
  /** `c-<conversationId>@reply.<domain>`; absent when nothing can carry a token. */
  replyTo?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Which address a client sees an email from (the email counterpart of
 * `SenderResolver`, design §5):
 *
 *   1. `MESSAGING#SETTINGS.companyEmail` — when it sits on the verified SES
 *      domain (an address elsewhere would be refused by SES, so it is only
 *      used as the display name's companion, never as `From`);
 *   2. `MESSAGING_EMAIL_FROM` — the configured sender.
 *
 * The display name is `companyName` from the same settings. `Reply-To`
 * carries the conversation token so the answer lands in the same thread.
 */
@Injectable()
export class EmailAddressResolver {
  private readonly logger = new Logger(EmailAddressResolver.name);

  constructor(
    @Inject(EMAIL_CONFIG) private readonly config: Pick<EmailConfig, 'fromAddress' | 'domain' | 'replyDomain'>,
    private readonly settings: MessagingSettingsRepository,
  ) {}

  /** Email can be sent at all: a sender address is configured. */
  get configured(): boolean {
    return Boolean(this.config.fromAddress);
  }

  async resolve(conversationId: string): Promise<ResolvedEmailSender | null> {
    if (!this.config.fromAddress) return null;

    let companyEmail: string | undefined;
    let companyName: string | undefined;
    try {
      const settings = await this.settings.get();
      companyEmail = settings?.companyEmail?.trim().toLowerCase() || undefined;
      companyName = settings?.companyName?.trim() || undefined;
    } catch (error) {
      this.logger.warn(`settings read failed: ${error instanceof Error ? error.message : error}`);
    }

    const from = companyEmail && this.onVerifiedDomain(companyEmail) ? companyEmail : this.config.fromAddress;
    return {
      from,
      fromHeader: formatAddress(from, companyName),
      replyTo: buildReplyAddress(conversationId, this.config),
    };
  }

  /** Only an address on the identity's domain may be a `From` (SES refuses the rest). */
  private onVerifiedDomain(address: string): boolean {
    if (!EMAIL.test(address)) return false;
    const domain = address.split('@')[1];
    const verified = this.config.domain ?? this.config.fromAddress?.split('@')[1];
    return !verified || domain === verified;
  }
}

/** RFC 5322 name-addr; the name is quoted when it carries anything but plain words. */
export function formatAddress(address: string, name?: string): string {
  if (!name) return address;
  const safe = name.replace(/[\r\n]+/g, ' ').trim();
  if (!safe) return address;
  const needsQuotes = /[^A-Za-z0-9 .'-]/.test(safe);
  const display = needsQuotes ? `"${safe.replace(/(["\\])/g, '\\$1')}"` : safe;
  return `${display} <${address}>`;
}
