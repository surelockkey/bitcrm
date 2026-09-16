import { Module } from '@nestjs/common';
import { MessagingSettingsRepository } from './messaging-settings.repository';
import { MessagingSettingsService } from './messaging-settings.service';
import { MessagingSettingsController } from './messaging-settings.controller';

@Module({
  controllers: [MessagingSettingsController],
  providers: [MessagingSettingsRepository, MessagingSettingsService],
  exports: [MessagingSettingsRepository, MessagingSettingsService],
})
export class MessagingSettingsModule {}
