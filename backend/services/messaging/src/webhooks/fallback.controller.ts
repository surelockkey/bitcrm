import { Body, Controller, Header, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';
import { Public, TwilioSignatureGuard } from '@bitcrm/shared';
import { FallbackCaptureService } from '../inbound/fallback-capture.service';
import { EMPTY_TWIML } from './inbound.controller';

/**
 * `POST /api/messaging/webhooks/twilio/fallback` — the Messaging Service's
 * Fallback URL. Twilio comes here after the primary webhook failed, with the
 * same form plus `ErrorCode` / `ErrorUrl`. The raw payload is archived to S3
 * and queued for replay without touching DynamoDB or the CRM (design §4.3),
 * so it works precisely when the primary could not. 200 as soon as at least
 * one of the two captures succeeded; 500 when neither did, so the failure is
 * visible in Twilio's debugger and our metrics rather than silently dropped.
 */
@ApiTags('Messaging webhooks')
@Public()
@UseGuards(TwilioSignatureGuard)
@Controller('webhooks/twilio')
export class FallbackWebhookController {
  constructor(private readonly capture: FallbackCaptureService) {}

  @Post('fallback')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  @ApiExcludeEndpoint()
  async fallback(
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const result = await this.capture.capture(payload);
    if (!result.s3Key && !result.queued) res.status(500);
    return EMPTY_TWIML;
  }
}
