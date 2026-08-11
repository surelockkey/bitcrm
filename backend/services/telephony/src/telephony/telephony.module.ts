import { Module } from '@nestjs/common';
import { TelephonyController } from './telephony.controller';
import { TelephonyService } from './telephony.service';
import { TELEPHONY_CONFIG, loadTelephonyConfig } from './telephony.config';

@Module({
  controllers: [TelephonyController],
  providers: [
    TelephonyService,
    { provide: TELEPHONY_CONFIG, useFactory: loadTelephonyConfig },
  ],
  exports: [TelephonyService, TELEPHONY_CONFIG],
})
export class TelephonyModule {}
