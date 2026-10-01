import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Redirect, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import type { Request } from 'express';
import { DeclineEstimateDto, SignDocumentDto } from '../signatures/dto/sign.dto';
import { PortalRateLimiter, clientIp } from './portal-rate-limiter';
import { isPlausibleToken } from './portal-token';
import { PortalService, portalUrl } from './portal.service';

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

  @Post(':token/estimate/:id/approve')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve an estimate (sign it)',
    description:
      '**Guard:** none (token), STRICT rate limit that fails closed. The signature is mandatory and is ' +
      'stored FIRST; then the estimate becomes `approved`. 404 unless sent and the token’s own; 422 if ' +
      'already decided. A deposit, when set, is collected next through the payment routes.',
  })
  async approve(
    @Param('token') token: string,
    @Param('id') id: string,
    @Body() dto: SignDocumentDto,
    @Req() req: Request,
  ) {
    const ip = clientIp(req);
    await this.limiter.checkWrite(ip, token);
    return { success: true, data: await this.portal.approveEstimate(token, id, { ...dto, ip }) };
  }

  @Post(':token/estimate/:id/decline')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Decline an estimate',
    description: '**Guard:** none (token), STRICT rate limit. Optional reason. 404 unless sent and the token’s own.',
  })
  async decline(
    @Param('token') token: string,
    @Param('id') id: string,
    @Body() dto: DeclineEstimateDto,
    @Req() req: Request,
  ) {
    await this.limiter.checkWrite(clientIp(req), token);
    return { success: true, data: await this.portal.declineEstimate(token, id, dto) };
  }

  @Post(':token/invoice/:id/sign')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign an invoice',
    description:
      '**Guard:** none (token), STRICT rate limit. Workiz "Request signature": the client signs before ' +
      'paying. 404 unless sent and the token’s own.',
  })
  async sign(
    @Param('token') token: string,
    @Param('id') id: string,
    @Body() dto: SignDocumentDto,
    @Req() req: Request,
  ) {
    const ip = clientIp(req);
    await this.limiter.checkWrite(ip, token);
    return { success: true, data: await this.portal.signInvoice(token, id, { ...dto, ip }) };
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
