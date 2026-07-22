import { Module } from '@nestjs/common';
import { JobSourcesController } from './job-sources.controller';
import { JobSourcesService } from './job-sources.service';
import { JobSourcesRepository } from './job-sources.repository';

@Module({
  controllers: [JobSourcesController],
  providers: [JobSourcesService, JobSourcesRepository],
  exports: [JobSourcesService],
})
export class JobSourcesModule {}
