import { Body, Controller, Header, HttpCode, Logger, Post, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { Public, TwilioSignatureGuard } from '@bitcrm/shared';
import { InboundService } from '../inbound/inbound.service';
import { MalformedInboundPayloadError, parseInboundPayload } from '../inbound/twilio-inbound.payload';

/** No auto-reply: Advanced Opt-Out answers STOP/HELP itself (design §4.3 step 9). */
export const EMPTY_TWIML = '<Response/>';

/**
 * `POST /api/messaging/webhooks/twilio/inbound` — what the Messaging Service
 * ("Incoming Messages → Send a webhook") and any number outside it (`SmsUrl`)
 * call for every inbound SMS/MMS. Called by Twilio, not the SPA, so it is
 * `@Public()` but gated by `TwilioSignatureGuard` (`X-Twilio-Signature` over
 * `PUBLIC_BASE_URL` + the original URL). The body arrives form-encoded
 * through Nest's default parser; the global `ValidationPipe` leaves a plain
 * object untouched, so `MediaUrl0…` and friends survive.
 *
 * Always answers `text/xml`: 200 `<Response/>` when stored or duplicate,
 * 400 `<Response/>` when the form cannot be a message (nothing to retry),
 * and whatever the exception filter renders when storage failed — a non-2xx
 * makes Twilio call the fallback URL, which is the point.
 */
@ApiTags('Messaging webhooks')
@Public()
@UseGuards(TwilioSignatureGuard)
@Controller('webhooks/twilio')
export class InboundWebhookController {
  private readonly logger = new Logger(InboundWebhookController.name);

  constructor(private readonly inboundService: InboundService) {}

  @Post('inbound')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async inbound(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    let input;
    try {
      input = parseInboundPayload(body);
    } catch (error) {
      if (error instanceof MalformedInboundPayloadError) {
        this.logger.warn(`Inbound webhook rejected: ${error.reason}`);
        res.status(400);
        return EMPTY_TWIML;
      }
      throw error;
    }

    await this.inboundService.ingest(input, { source: 'webhook' });
    return EMPTY_TWIML;
  }
}
