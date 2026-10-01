import { Module } from '@nestjs/common';
import { DealTotalsController } from './deal-totals.controller';
import { DealTotalsRepository } from './deal-totals.repository';

/** Read-only: job totals for other services' reports (Call Tracking revenue). */
@Module({
  controllers: [DealTotalsController],
  providers: [DealTotalsRepository],
})
export class DealTotalsModule {}
