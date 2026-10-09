import { Module } from '@nestjs/common';
import { NumberingController } from './numbering.controller';
import { NumberingRepository } from './numbering.repository';
import { NumberingService } from './numbering.service';

/**
 * Settings → Numbering: the account's client-document counters. Imported by
 * EstimatesModule and InvoicesModule, whose client documents take their
 * numbers from it.
 */
@Module({
  controllers: [NumberingController],
  providers: [NumberingRepository, NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
