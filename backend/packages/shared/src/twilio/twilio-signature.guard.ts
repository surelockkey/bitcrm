import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import twilio from 'twilio';
import { TWILIO_CONFIG, type TwilioConfig } from './twilio.config';

/** The slice of `TwilioConfig` the signature check reads. */
export type TwilioSignatureOptions = Pick<
  TwilioConfig,
  'authToken' | 'publicBaseUrl' | 'validateSignature'
>;

/** The parts of an incoming request the signature is computed over. */
export interface TwilioSignedRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Path + query as the client sent it — Express's `originalUrl`. */
  originalUrl?: string;
  url?: string;
  body?: unknown;
}

/**
 * Does `X-Twilio-Signature` match this request? The signature is computed by
 * Twilio over the *public* URL it hit, which differs from what a service sees
 * behind nginx — so it is rebuilt from `publicBaseUrl` + the original path.
 *
 * A pure function so code outside a Nest guard (a fallback-capture handler,
 * a queue consumer replaying a webhook) can make the same check.
 */
export function isValidTwilioRequest(
  options: Pick<TwilioSignatureOptions, 'authToken' | 'publicBaseUrl'>,
  req: TwilioSignedRequest,
): boolean {
  const header = req.headers['x-twilio-signature'];
  const signature = Array.isArray(header) ? header[0] : header;
  const url = `${options.publicBaseUrl}${req.originalUrl ?? req.url ?? ''}`;
  return twilio.validateRequest(
    options.authToken,
    signature ?? '',
    url,
    (req.body ?? {}) as Record<string, unknown>,
  );
}

/**
 * Validates the `X-Twilio-Signature` header so only Twilio can invoke our
 * public webhooks (voice today, SMS next). Bind it to a route with
 * `@Public()` + `@UseGuards(TwilioSignatureGuard)`; the config comes from
 * whatever the service provides under `TWILIO_CONFIG` (telephony provides its
 * superset `TelephonyConfig` under the same token).
 *
 * Disabled when `validateSignature` is false (local curl testing).
 */
@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TwilioSignatureGuard.name);

  constructor(
    @Inject(TWILIO_CONFIG) private readonly config: TwilioSignatureOptions,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.validateSignature) return true;

    const req = context.switchToHttp().getRequest<TwilioSignedRequest>();
    if (!isValidTwilioRequest(this.config, req)) {
      const url = `${this.config.publicBaseUrl}${req.originalUrl ?? req.url ?? ''}`;
      this.logger.warn(`Rejected webhook with invalid Twilio signature: ${url}`);
      throw new ForbiddenException('Invalid Twilio signature');
    }
    return true;
  }
}
