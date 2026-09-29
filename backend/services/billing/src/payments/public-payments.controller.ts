import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import type { Request } from 'express';
import { PortalRateLimiter, clientIp } from '../portal/portal-rate-limiter';
import { PortalPayDto } from './dto/portal-pay.dto';
import { PortalPaymentsService } from './portal-payments.service';

/**
 * The client's own three routes, behind the portal token. Registered AFTER
 * PortalModule: `:token/invoice/:id/payment-options` and `:token/:kind/:id/html`
 * differ in their last literal segment, so neither shadows the other.
 *
 * The write route uses the STRICT limiter, which fails CLOSED — a Redis outage
 * may make the portal read-only, but it must never open the door to an
 * unthrottled payment endpoint.
 */
@ApiTags('Client portal (public)')
@Controller('public/portal')
export class PublicPaymentsController {
  constructor(
    private readonly payments: PortalPaymentsService,
    private readonly limiter: PortalRateLimiter,
  ) {}

  @Get(':token/invoice/:id/payment-options')
  @Public()
  @ApiOperation({
    summary: 'What this invoice can be paid with',
    description:
      '**Guard:** none (token in the path), rate limited per IP + token. 404 unless the invoice ' +
      'belongs to the token’s contact AND has been sent. `amountDue: 0` (nothing owed) and ' +
      '`methods: []` (online payment unavailable) are different answers.',
  })
  async options(@Param('token') token: string, @Param('id') id: string, @Req() req: Request) {
    await this.limiter.check(clientIp(req), token);
    return { success: true, data: await this.payments.options(token, id) };
  }

  @Post(':token/invoice/:id/pay')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start a payment',
    description:
      '**Guard:** none (token), STRICT rate limit that fails closed. The amount is re-clamped ' +
      'server-side to `0 < x ≤ balance`; a second attempt supersedes the unfinished one rather than ' +
      'being refused. → `PortalPaymentSession` (client secret + publishable key).',
  })
  async pay(
    @Param('token') token: string,
    @Param('id') id: string,
    @Body() dto: PortalPayDto,
    @Req() req: Request,
  ) {
    await this.limiter.checkWrite(clientIp(req), token);
    return { success: true, data: await this.payments.pay(token, id, dto) };
  }

  @Get(':token/payment/:paymentId')
  @Public()
  @ApiOperation({
    summary: 'Poll a payment after returning from Stripe',
    description:
      '**Guard:** none (token), rate limited. → `{status, amount, method, receiptSent}`. A `pending` ' +
      '`bank` payment is a genuine multi-day ACH wait; a `pending` `card` payment just means the ' +
      'webhook has not landed yet.',
  })
  async status(@Param('token') token: string, @Param('paymentId') paymentId: string, @Req() req: Request) {
    await this.limiter.check(clientIp(req), token);
    return { success: true, data: await this.payments.status(token, paymentId) };
  }
}
