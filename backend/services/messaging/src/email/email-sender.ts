import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SendEmailCommand, type SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { S3Service } from '@bitcrm/shared';
import { type MessageAttachment } from '@bitcrm/types';
import { attachmentLinksSection, type AttachmentLink } from './email-body';
import { EMAIL_CONFIG, type EmailConfig } from './email.config';
import { buildMimeMessage, type MimeAttachment } from './mime/mime-builder';

/** `SESv2Client`, narrowed so tests hand in a recorder without the SDK types. */
export interface SesSendApi {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

export const SES_CLIENT = Symbol('SES_CLIENT');
export const EMAIL_SENDER_OPTIONS = Symbol('EMAIL_SENDER_OPTIONS');

export interface EmailSenderOptions {
  /** Overridable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per-attachment download budget. */
  timeoutMs?: number;
}

/** One outbound mail as the worker hands it over — addresses already resolved, bodies already rendered. */
export interface OutboundEmail {
  conversationId: string;
  messageId: string;
  createdAt: string;
  /** Bare sender address. */
  from: string;
  /** `"Name" <from>` — the header value. */
  fromHeader: string;
  replyTo?: string;
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: MessageAttachment[];
}

export interface EmailSendResult {
  /** The SES message id — `providerSid` on the message, the key of every later event. */
  messageId: string;
  /** How the attachments went out: as MIME parts, as presigned links, or there were none. */
  attachments: 'inline' | 'links' | 'none';
}

/** SES `EmailTags` names — what the event consumer reads the message key back from. */
export const TAG_CONVERSATION = 'bitcrm-conversation';
export const TAG_MESSAGE = 'bitcrm-message';
/** Epoch milliseconds of `createdAt`: tag values may only carry `[A-Za-z0-9_-]`, not an ISO timestamp. */
export const TAG_CREATED = 'bitcrm-created';

/**
 * The SES v2 `SendEmail` call (design §5, variant A). Plain mails go as
 * `Simple` content with threading headers; a mail whose stored attachments
 * fit `maxInlineAttachmentBytes` is built as raw MIME with the files inside;
 * bigger ones get a footer of presigned S3 links instead (`attachmentLinkTtlSeconds`).
 * Every send carries the configuration set (event destination) and three
 * tags that let the event consumer address the message without a lookup.
 *
 * Attachment bytes are fetched through presigned GET URLs — the same objects
 * the composer PUT — so nothing here needs a second S3 client.
 */
@Injectable()
export class EmailSender {
  private readonly logger = new Logger(EmailSender.name);
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    @Inject(SES_CLIENT) private readonly ses: SesSendApi,
    private readonly s3: S3Service,
    @Inject(EMAIL_CONFIG)
    private readonly config: Pick<
      EmailConfig,
      'configurationSet' | 'maxInlineAttachmentBytes' | 'attachmentLinkTtlSeconds'
    >,
    @Optional() @Inject(EMAIL_SENDER_OPTIONS) opts: EmailSenderOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async send(email: OutboundEmail): Promise<EmailSendResult> {
    const stored = (email.attachments ?? []).filter((a) => a.status === 'stored' && a.s3Key);
    const total = stored.reduce((sum, a) => sum + (a.size ?? 0), 0);
    const inline = stored.length > 0 && total <= this.config.maxInlineAttachmentBytes;

    const input: SendEmailCommandInput = {
      FromEmailAddress: email.fromHeader,
      Destination: { ToAddresses: [email.to], ...(email.cc?.length ? { CcAddresses: email.cc } : {}) },
      ...(email.replyTo ? { ReplyToAddresses: [email.replyTo] } : {}),
      ...(this.config.configurationSet ? { ConfigurationSetName: this.config.configurationSet } : {}),
      EmailTags: [
        { Name: TAG_CONVERSATION, Value: email.conversationId },
        { Name: TAG_MESSAGE, Value: email.messageId },
        { Name: TAG_CREATED, Value: String(Date.parse(email.createdAt)) },
      ],
      Content: inline ? await this.rawContent(email, stored) : await this.simpleContent(email, stored),
    };

    const res = await this.ses.send(new SendEmailCommand(input));
    if (!res.MessageId) throw new Error('SES accepted the message but returned no MessageId');
    this.logger.log(`SES accepted ${email.messageId} as ${res.MessageId} (${inline ? 'inline' : stored.length ? 'links' : 'no'} attachments)`);
    return { messageId: res.MessageId, attachments: inline ? 'inline' : stored.length ? 'links' : 'none' };
  }

  // ------------------------------------------------------------ internals

  private async simpleContent(email: OutboundEmail, stored: MessageAttachment[]): Promise<SendEmailCommandInput['Content']> {
    const links: AttachmentLink[] = await Promise.all(
      stored.map(async (a) => ({
        fileName: a.fileName,
        size: a.size,
        url: await this.s3.getPresignedDownloadUrl(a.s3Key!, this.config.attachmentLinkTtlSeconds),
      })),
    );
    const footer = attachmentLinksSection(links);
    const text = email.text + footer.text;
    const html = email.html ? email.html + footer.html : undefined;
    const headers = this.threadingHeaders(email);
    return {
      Simple: {
        Subject: { Data: email.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: text, Charset: 'UTF-8' },
          ...(html ? { Html: { Data: html, Charset: 'UTF-8' } } : {}),
        },
        ...(headers.length ? { Headers: headers } : {}),
      },
    };
  }

  private async rawContent(email: OutboundEmail, stored: MessageAttachment[]): Promise<SendEmailCommandInput['Content']> {
    const attachments: MimeAttachment[] = [];
    for (const a of stored) {
      attachments.push({ fileName: a.fileName, contentType: a.contentType, content: await this.download(a) });
    }
    const raw = buildMimeMessage({
      from: email.fromHeader,
      to: [email.to],
      cc: email.cc,
      replyTo: email.replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html,
      inReplyTo: email.inReplyTo,
      references: email.references,
      attachments,
    });
    return { Raw: { Data: raw } };
  }

  private threadingHeaders(email: OutboundEmail): Array<{ Name: string; Value: string }> {
    const headers: Array<{ Name: string; Value: string }> = [];
    if (email.inReplyTo) headers.push({ Name: 'In-Reply-To', Value: email.inReplyTo });
    if (email.references?.length) headers.push({ Name: 'References', Value: email.references.join(' ') });
    return headers;
  }

  /** The object the composer uploaded, through a short presigned GET; any failure is transient (rethrown → retry). */
  private async download(a: MessageAttachment): Promise<Buffer> {
    const url = await this.s3.getPresignedDownloadUrl(a.s3Key!, 300);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching attachment ${a.id}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
}
