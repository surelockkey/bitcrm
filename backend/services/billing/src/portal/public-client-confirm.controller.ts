import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import type { Request } from 'express';
import { ClientConfirmPageService } from './client-confirm-page.service';
import { PortalRateLimiter, clientIp } from './portal-rate-limiter';

/**
 * `apps/portal`'s `/confirm/<token>` page: the client confirms their visit
 * (B12, Workiz `{{confirm_link}}`). The token is the whole authorisation.
 *
 * Both routes take the portal's ordinary limiter (fail-open). The write is
 * idempotent on deal-service's side — a second tap records nothing — so the
 * strict money limiter, which fails closed and talks about payments, is not
 * the right one here.
 */
@ApiTags('Client portal (public)')
@Controller('public/confirm')
export class PublicClientConfirmController {
  constructor(
    private readonly page: ClientConfirmPageService,
    private readonly limiter: PortalRateLimiter,
  ) {}

  @Get(':token')
  @Public()
  @ApiOperation({
    summary: "The client's confirm-your-appointment page",
    description:
      '**Guard:** none (the job\'s signed token in the path), rate limited per IP + token. `ClientConfirmView`: ' +
      'state (open | confirmed | closed | expired), the job\'s company (name, logo, phone), the visit on the ' +
      'job\'s own clock, address, job type. 404 for a link that is not one of ours.',
  })
  async view(@Param('token') token: string, @Req() req: Request) {
    await this.limiter.check(clientIp(req), token);
    return { success: true, data: await this.page.view(token) };
  }

  @Post(':token')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'The client confirms the appointment',
    description:
      '**Guard:** none (token), rate limited. No body. While the visit is open deal-service records ' +
      '`clientConfirmedAt` once, writes "Client Confirmed job" to the job\'s history and publishes ' +
      '`deal.client_confirmed`; otherwise nothing changes. Answers the page\'s new state either way.',
  })
  async confirm(@Param('token') token: string, @Req() req: Request) {
    const ip = clientIp(req);
    await this.limiter.check(ip, token);
    const userAgent = req.headers['user-agent'];
    return { success: true, data: await this.page.confirm(token, { ip, ...(userAgent && { userAgent }) }) };
  }
}
