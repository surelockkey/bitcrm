import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsRepository } from './automations.repository';
import { AutomationsService } from './automations.service';

/**
 * Automations (design §10 M21). This commit: the rules as data —
 * `AUTOMATION#` repository, built-in defaults, `GET/PATCH /automations`.
 * The executors (New-job SMS consumer on `deal-events-to-messaging`,
 * on-my-way / late) are added next.
 */
@Module({
  controllers: [AutomationsController],
  providers: [AutomationsRepository, AutomationsService],
  exports: [AutomationsRepository, AutomationsService],
})
export class AutomationsModule {}
