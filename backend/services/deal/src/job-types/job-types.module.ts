import { Module } from '@nestjs/common';
import { JobTypesController } from './job-types.controller';
import { JobTypesService } from './job-types.service';
import { JobTypesRepository } from './job-types.repository';

@Module({
  controllers: [JobTypesController],
  providers: [JobTypesService, JobTypesRepository],
  exports: [JobTypesService],
})
export class JobTypesModule {}
