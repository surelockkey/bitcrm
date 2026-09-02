import { forwardRef, Module } from '@nestjs/common';
import { TelephonyController } from './telephony.controller';
import { TelephonyService } from './telephony.service';
import { TelephonySettingsService } from './telephony-settings.service';
import { TELEPHONY_CONFIG, loadTelephonyConfig } from './telephony.config';
import { NumbersModule } from '../numbers/numbers.module';

@Module({
  // The settings service validates a designated line against the numbers the
  // workspace owns, and NumbersModule already imports this one for the config —
  // hence the forwardRef pair. DynamoDbModule is @Global, so nothing to import.
  imports: [forwardRef(() => NumbersModule)],
  controllers: [TelephonyController],
  providers: [
    TelephonyService,
    TelephonySettingsService,
    { provide: TELEPHONY_CONFIG, useFactory: loadTelephonyConfig },
  ],
  exports: [TelephonyService, TelephonySettingsService, TELEPHONY_CONFIG],
})
export class TelephonyModule {}
