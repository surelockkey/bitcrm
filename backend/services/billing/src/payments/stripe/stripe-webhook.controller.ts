import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import type { Request } from 'express';
import { StripeEventsHandler } from './stripe-events.handler';
import { StripeService, WebhookSignatureError } from './stripe.service';

/**
 * Stripe's webhook endpoint: `POST /api/billing/webhooks/stripe`.
 *
 * The signature is computed over the EXACT bytes Stripe sent, so this handler
 * needs `req.rawBody` — which only exists because `main.ts` creates the app
 * with `{ rawBody: true }` and re-registers the enlarged JSON parser through
 * `app.useBodyParser`. A `MiddlewareConsumer` cannot do this: Nest middleware
 * runs AFTER the global body parsers, by which point the bytes are gone.
 * `stripe-webhook.http.spec.ts` posts real signed bytes through the real
 * pipeline to keep that true.
 *
 * Answer fast, then work: the event id is claimed synchronously (so a replay
 * is recognised), and the handler processes it after the 200. A verification
 * failure is a 400 — Stripe must not retry something it signed wrongly.
 */
@ApiTags('Stripe webhooks')
@Controller('webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly handler: StripeEventsHandler,
  ) {}

  @Post('stripe')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Stripe webhook',
    description:
      '**Guard:** none — authenticated by the `stripe-signature` header over the raw body ' +
      '(`STRIPE_WEBHOOK_SECRET`). 400 on a bad signature or a stale timestamp; 200 once, and 200 ' +
      'again for a replay of the same `event.id`.',
  })
  async stripe_(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    let event;
    try {
      event = this.stripe.constructEvent(req.rawBody, signature);
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        this.logger.warn(`rejected stripe webhook: ${err.message}`);
        throw new BadRequestException(`Webhook signature verification failed: ${err.message}`);
      }
      throw err;
    }
    const accepted = await this.handler.receive(event);
    return { received: true, duplicate: !accepted };
  }
}
