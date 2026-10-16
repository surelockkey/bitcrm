import { Module } from '@nestjs/common';
import { PushRepository } from './push.repository';
import { PushTokensController } from './push-tokens.controller';
import { PushTokensService } from './push-tokens.service';

/**
 * Push notifications to the technician app through the Expo push service:
 * the device registry (`PUT` / `DELETE /push-tokens`).
 */
@Module({
  controllers: [PushTokensController],
  providers: [PushRepository, PushTokensService],
  exports: [PushRepository],
})
export class PushModule {}
