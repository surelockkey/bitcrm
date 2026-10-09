import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export const EMAIL_CODE_CONFIG = Symbol('EMAIL_CODE_CONFIG');
export const EMAIL_CODE_SES = Symbol('EMAIL_CODE_SES');

export interface EmailCodeConfig {
  /** The verified sender, `MESSAGING_EMAIL_FROM` — the address messaging mails from. Empty: no email codes. */
  from: string;
  /** `SES_CONFIGURATION_SET`, when the account has one. */
  configurationSet?: string;
}

/** `SESv2Client`, narrowed so tests hand in a recorder without the SDK types. */
export interface SesSendApi {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

/** Read from the environment the deploy fills: the same sender identity messaging uses. */
export function emailCodeConfigFromEnv(): EmailCodeConfig {
  return {
    from: process.env.MESSAGING_EMAIL_FROM || '',
    configurationSet: process.env.SES_CONFIGURATION_SET || undefined,
  };
}

export function sesClientFromEnv(): SesSendApi {
  return new SESv2Client({
    region: process.env.AWS_REGION || 'us-east-1',
    ...(process.env.AWS_ENDPOINT && {
      endpoint: process.env.AWS_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  });
}

/**
 * A sign-in code by email — Workiz's "Login sending options" — over the SES
 * identity messaging already mails from, so the option needs no new
 * infrastructure beyond `ses:SendEmail` on this service's task role.
 * Without `MESSAGING_EMAIL_FROM` there is no email option: `available` is
 * what the Security Center's switch and the sign-in gate ask before
 * offering it, and `send` refuses rather than pretend.
 *
 * The code itself is minted and checked by `MfaService` (a hash of it waits
 * with the challenge); this only carries it.
 */
@Injectable()
export class EmailCodeSender {
  private readonly logger = new Logger(EmailCodeSender.name);

  constructor(
    @Inject(EMAIL_CODE_CONFIG) private readonly config: EmailCodeConfig,
    @Inject(EMAIL_CODE_SES) private readonly ses: SesSendApi,
  ) {}

  get available(): boolean {
    return Boolean(this.config.from);
  }

  async send(to: string, code: string): Promise<void> {
    if (!this.available) {
      throw new ServiceUnavailableException('Sign-in codes by email are not set up on this server.');
    }
    try {
      await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: this.config.from,
          Destination: { ToAddresses: [to] },
          ...(this.config.configurationSet && { ConfigurationSetName: this.config.configurationSet }),
          Content: {
            Simple: {
              Subject: { Data: `${code} is your BitCRM sign-in code`, Charset: 'UTF-8' },
              Body: {
                Text: {
                  Data:
                    `Your sign-in code is ${code}. It expires in 5 minutes.\n\n` +
                    'If you did not just sign in to BitCRM, you can ignore this email.',
                  Charset: 'UTF-8',
                },
              },
            },
          },
        }),
      );
    } catch (error) {
      this.logger.warn(`Could not email a sign-in code: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException('Could not email the sign-in code. Try again in a minute.');
    }
  }
}
