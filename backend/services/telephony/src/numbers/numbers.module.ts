import { Module } from '@nestjs/common';
import { NumbersController } from './numbers.controller';
import { NumbersService } from './numbers.service';
import { TelephonyModule } from '../telephony/telephony.module';

@Module({
  imports: [TelephonyModule], // for TELEPHONY_CONFIG
  controllers: [NumbersController],
  providers: [NumbersService],
  exports: [NumbersService],
})
export class NumbersModule {}
