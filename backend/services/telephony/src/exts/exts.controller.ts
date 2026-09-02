import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ExtsService } from './exts.service';
import { BridgeService } from '../common/bridge.service';
import { DealReadService } from '../common/deal-read.service';

/**
 * Job codes, for the job screen's dial card.
 *
 * Shown to anyone who may place a call about the job — INCLUDING a masked
 * user, because the code is precisely what a masked user gets INSTEAD of the
 * number. A screenshot of it is harmless: the code is a routing key, and the
 * PIN that makes it work is never on the screen.
 */
@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('exts')
export class ExtsController {
  constructor(
    private readonly exts: ExtsService,
    private readonly bridge: BridgeService,
    private readonly deals: DealReadService,
  ) {}

  @Get('by-deal/:dealId')
  @ApiOperation({
    summary: "The technician-line code for a job",
    description:
      'Any authenticated user who may place a call about the job. Minted on ' +
      'first ask — most jobs never need one.',
  })
  async byDeal(@Param('dealId') dealId: string, @CurrentUser() user: JwtUser) {
    const deal = await this.deals.find(dealId);
    if (!deal) throw new NotFoundException('Job not found');
    if (!this.bridge.mayReachDeal(user, deal)) {
      throw new ForbiddenException('You cannot place a call about this job');
    }

    const ext = await this.exts.forDeal(dealId);
    return { success: true, data: { code: ext.code } };
  }

  @Post('by-deal/:dealId/rotate')
  @ApiOperation({
    summary: 'Retire a job code and mint a new one',
    description:
      'The containment lever when a code has been shared too widely. Scoped ' +
      'to one job, so it never disturbs anybody else.',
  })
  async rotate(@Param('dealId') dealId: string, @CurrentUser() user: JwtUser) {
    const deal = await this.deals.find(dealId);
    if (!deal) throw new NotFoundException('Job not found');
    if (!this.bridge.mayReachDeal(user, deal)) {
      throw new ForbiddenException('You cannot place a call about this job');
    }

    const ext = await this.exts.rotate(dealId);
    return { success: true, data: { code: ext.code } };
  }
}
