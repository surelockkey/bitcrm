import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@bitcrm/shared';
import type { Request } from 'express';
import { PortalRateLimiter } from './portal-rate-limiter';
import { PortalService } from './portal.service';

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
