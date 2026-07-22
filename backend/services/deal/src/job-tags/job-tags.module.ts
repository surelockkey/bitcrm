import { Module } from '@nestjs/common';
import { JobTagsController } from './job-tags.controller';
import { JobTagsService } from './job-tags.service';
import { JobTagsRepository } from './job-tags.repository';

@Module({
  controllers: [JobTagsController],
  providers: [JobTagsService, JobTagsRepository],
  exports: [JobTagsService],
})
export class JobTagsModule {}
