import { Module } from '@nestjs/common';
import { JobRulesController } from './job-rules.controller';
import { JobRulesService } from './job-rules.service';
import { JobRulesRepository } from './job-rules.repository';

@Module({
  controllers: [JobRulesController],
  providers: [JobRulesService, JobRulesRepository],
  exports: [JobRulesService],
})
export class JobRulesModule {}
