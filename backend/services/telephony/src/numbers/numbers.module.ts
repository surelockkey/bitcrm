import { Module } from '@nestjs/common';
import { NumbersController } from './numbers.controller';
import { NumbersService } from './numbers.service';
import { NumberSettingsRepository } from './number-settings.repository';
import { TelephonyModule } from '../telephony/telephony.module';

@Module({
  imports: [TelephonyModule], // for TELEPHONY_CONFIG
  controllers: [NumbersController],
  providers: [NumbersService, NumberSettingsRepository],
  exports: [NumbersService, NumberSettingsRepository],
})
export class NumbersModule {}
