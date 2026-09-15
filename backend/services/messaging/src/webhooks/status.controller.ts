import { Body, Controller, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Public, TwilioSignatureGuard } from '@bitcrm/shared';
import {
  StatusCallbackService,
  type StatusCallbackQuery,
  type TwilioStatusBody,
} from '../outbound/status-callback.service';

/**
 * Twilio's outbound status callback (design §4.3 route table, §4.5). Called
 * by Twilio, not the SPA: `@Public()` (no Cognito) behind the signature
 * guard, which recomputes the signature over `PUBLIC_BASE_URL + originalUrl`
 * — query string included, so the `c`/`t`/`m` routing params cannot be
 * forged. Always 204: Twilio only wants a 2xx, and an out-of-order or
 * repeated callback is a no-op by construction.
 */
@ApiTags('Messaging')
@Public()
@UseGuards(TwilioSignatureGuard)
@Controller('webhooks/twilio')
export class StatusController {
  constructor(private readonly service: StatusCallbackService) {}

  @Post('status')
  @HttpCode(204)
  @ApiExcludeEndpoint()
  async status(@Query() query: StatusCallbackQuery, @Body() body: TwilioStatusBody): Promise<void> {
    await this.service.handle(query ?? {}, body ?? {});
  }
}
