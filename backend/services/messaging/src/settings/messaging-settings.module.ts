import { Module } from '@nestjs/common';
import { MessagingSettingsRepository } from './messaging-settings.repository';

@Module({
  providers: [MessagingSettingsRepository],
  exports: [MessagingSettingsRepository],
})
export class MessagingSettingsModule {}
