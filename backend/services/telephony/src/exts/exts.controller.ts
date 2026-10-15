import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { ExtsService } from './exts.service';
import { BridgeService } from '../common/bridge.service';
import { DealReadService } from '../common/deal-read.service';
import { ContactLookupService } from '../common/contact-lookup.service';
import { clientLineCount } from '../common/client-line';

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
    private readonly contacts: ContactLookupService,
  ) {}

  @Get('by-deal/:dealId')
  @ApiOperation({
    summary: 'The technician-line codes for a job — one per client number',
    description:
      '**Guard:** any authenticated user who may place a call about the job ' +
      '(a technician must be on its roster, as must anybody whose deals are ' +
      'scoped `assigned_only`). Answers `{ code, phones: [{ phoneIndex, code }] }`: ' +
      'a code for every client number on the job, in the call buttons\' ' +
      '`phoneIndex` order, and `code` = the first number\'s (the one code ' +
      'the job had before codes were per number). Never a phone number. ' +
      'Minted on first ask — most jobs never need one.',
  })
  async byDeal(@Param('dealId') dealId: string, @CurrentUser() user: JwtUser) {
    const deal = await this.deals.find(dealId);
    if (!deal) throw new NotFoundException('Job not found');
    if (!(await this.bridge.mayReachDeal(user, deal))) {
      throw new ForbiddenException('You cannot place a call about this job');
    }

    // How many numbers — never which. An unreadable client still gets the
    // first number's code, which is all the job ever had.
    const client = await this.contacts.phonesOf(deal.contactId);
    const exts = await this.exts.forDealPhones(dealId, clientLineCount(deal, client));
    const phones = exts.map((ext, i) => ({ phoneIndex: ext.phoneIndex ?? i, code: ext.code }));
    return { success: true, data: { code: phones[0].code, phones } };
  }

  @Post('by-deal/:dealId/rotate')
  @ApiOperation({
    summary: 'Retire a job code and mint a new one',
    description:
      '**Guard:** as `GET by-deal/:dealId`. The containment lever when a code ' +
      'has been shared too widely. `?phoneIndex=` names the client number ' +
      '(default the first). Scoped to that one code, so it never disturbs ' +
      'anybody else.',
  })
  async rotate(
    @Param('dealId') dealId: string,
    @CurrentUser() user: JwtUser,
    @Query('phoneIndex') phoneIndexRaw?: string,
  ) {
    const deal = await this.deals.find(dealId);
    if (!deal) throw new NotFoundException('Job not found');
    if (!(await this.bridge.mayReachDeal(user, deal))) {
      throw new ForbiddenException('You cannot place a call about this job');
    }

    // No ValidationPipe in this service — coerce here.
    const parsed = Number(phoneIndexRaw ?? 0);
    const phoneIndex = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    const ext = await this.exts.rotate(dealId, phoneIndex);
    return { success: true, data: { code: ext.code, phoneIndex } };
  }
}
