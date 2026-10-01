import { Module } from '@nestjs/common';
import { EstimatesModule } from '../estimates/estimates.module';
import { ProposalsController } from './proposals.controller';
import { ProposalsRepository } from './proposals.repository';
import { ProposalsService } from './proposals.service';

/** Sales proposals (good / better / best) over the job's estimates. */
@Module({
  imports: [EstimatesModule],
  controllers: [ProposalsController],
  providers: [ProposalsRepository, ProposalsService],
  exports: [ProposalsService],
})
export class ProposalsModule {}
