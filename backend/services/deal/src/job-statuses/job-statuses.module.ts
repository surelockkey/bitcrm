import { Module } from '@nestjs/common';
import { JobStatusesController } from './job-statuses.controller';
import { JobStatusesService } from './job-statuses.service';
import { JobStatusesRepository } from './job-statuses.repository';

@Module({
  controllers: [JobStatusesController],
  providers: [JobStatusesService, JobStatusesRepository],
  exports: [JobStatusesService],
})
export class JobStatusesModule {}
