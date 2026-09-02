import { forwardRef, Module } from '@nestjs/common';
import { NumbersController } from './numbers.controller';
import { NumbersService } from './numbers.service';
import { NumberSettingsRepository } from './number-settings.repository';
import { TelephonyModule } from '../telephony/telephony.module';
import { CallFlowsModule } from '../call-flows/call-flows.module';
import { ServiceAreaNumbersService } from '../common/service-area-numbers.service';
import { LinesHealthService } from './lines-health.service';

@Module({
  // CallFlowsModule and the service-area map are here for one reason: releasing
  // a number has to know what still points at it, or a market quietly ends up
  // dialling from a number the workspace no longer owns.
  imports: [forwardRef(() => TelephonyModule), CallFlowsModule],
  controllers: [NumbersController],
  providers: [
    NumbersService,
    NumberSettingsRepository,
    ServiceAreaNumbersService,
    LinesHealthService,
  ],
  exports: [NumbersService, NumberSettingsRepository],
})
export class NumbersModule {}
