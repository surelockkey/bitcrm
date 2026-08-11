import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import twilio from 'twilio';
import { TELEPHONY_CONFIG, type TelephonyConfig } from '../telephony/telephony.config';

/**
 * Validates the `X-Twilio-Signature` header so only Twilio can invoke our
 * public voice webhooks. The signature is computed over the *public* URL Twilio
 * hit, which differs from what the service sees behind nginx — so we rebuild it
 * from `PUBLIC_BASE_URL` + the original path.
 *
 * Disabled when `validateSignature` is false (local curl testing).
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TwilioSignatureGuard.name);

  constructor(
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.validateSignature) return true;

    const req = context.switchToHttp().getRequest();
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    const url = `${this.config.publicBaseUrl}${req.originalUrl}`;

    const valid = twilio.validateRequest(
      this.config.authToken,
      signature ?? '',
      url,
      (req.body ?? {}) as Record<string, unknown>,
    );

    if (!valid) {
      this.logger.warn(`Rejected webhook with invalid Twilio signature: ${url}`);
      throw new ForbiddenException('Invalid Twilio signature');
    }
    return true;
  }
}
