import { Controller, Get, NotFoundException, Param, Query, Redirect, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import type { Request } from 'express';
import { PortalRateLimiter } from './portal-rate-limiter';
import { isPlausibleToken } from './portal-token';
import { PortalService, portalUrl } from './portal.service';

/** Behind nginx/ALB the socket address is the proxy's; the first forwarded hop is the client. */
function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || (req.headers['x-real-ip'] as string | undefined) || req.ip || 'unknown';
}

@ApiTags('Client portal (public)')
@Controller('public/portal')
export class PublicPortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly limiter: PortalRateLimiter,
  ) {}

  @Get(':token')
  @Public()
  @ApiOperation({
    summary: 'Client portal',
    description: '**Guard:** none (bearer token in the path), rate limited per IP + token. Only sent documents.',
  })
  async view(@Param('token') token: string, @Req() req: Request) {
    await this.limiter.check(clientIp(req), token);
    return { success: true, data: await this.portal.publicView(token) };
  }

  @Get(':token/:kind/:id/html')
  @Public()
  @ApiOperation({
    summary: 'Client portal document, as a web page',
    description:
      '**Guard:** none (token), rate limited. The rendered document HTML the portal shows first (the PDF is the download). ' +
      '404 unless the document is sent and belongs to the token’s contact.',
  })
  async html(
    @Param('token') token: string,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    await this.limiter.check(clientIp(req), token);
    return { success: true, data: await this.portal.publicHtml(token, kind, id) };
  }

  @Get(':token/:kind/:id/pdf')
  @Public()
  @ApiOperation({
    summary: 'Client portal document PDF',
    description: '**Guard:** none (token), rate limited. 404 unless the document is sent and belongs to the token’s contact.',
  })
  async pdf(
    @Param('token') token: string,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
  ) {
    await this.limiter.check(clientIp(req), token);
    const asAttachment = download === '1' || download === 'true';
    return { success: true, data: await this.portal.publicPdf(token, kind, id, asAttachment) };
  }
}

/**
 * Links sent before the portal had its own domain read `<api host>/portal/<token>`,
 * and the API answered 404. This sits OUTSIDE the `api/billing` prefix (see
 * `main.ts`; the ALB forwards `/portal/*` here) and hands those links on to the
 * portal, so the ones already in clients' phones start working.
 */
@ApiTags('Client portal (public)')
@Controller('portal')
export class LegacyPortalRedirectController {
  @Get(':token')
  @Public()
  @Redirect(undefined, 302)
  @ApiOperation({
    summary: 'Redirect an old-style portal link to the portal domain',
    description: '**Guard:** none. 302 to `PORTAL_BASE_URL/<token>`; the token is not checked here.',
  })
  redirect(@Param('token') token: string) {
    if (!isPlausibleToken(token)) throw new NotFoundException('This link is no longer valid');
    return { url: portalUrl(token) };
  }
}
