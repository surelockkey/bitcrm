import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { UserDirectoryService } from '../common/user-directory.service';
import { PresenceController } from './presence.controller';

@Module({
  controllers: [PresenceController],
  providers: [PresenceService, UserDirectoryService],
  exports: [PresenceService, UserDirectoryService],
})
export class PresenceModule {}
