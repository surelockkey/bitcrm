import { Module } from '@nestjs/common';
import { JobFieldSettingsController } from './job-field-settings.controller';
import { JobFieldSettingsService } from './job-field-settings.service';
import { JobFieldSettingsRepository } from './job-field-settings.repository';

@Module({
  controllers: [JobFieldSettingsController],
  providers: [JobFieldSettingsService, JobFieldSettingsRepository],
  exports: [JobFieldSettingsService],
})
export class JobFieldSettingsModule {}
