import { Module } from '@nestjs/common';
import { OptOutsRepository } from './opt-outs.repository';

@Module({
  providers: [OptOutsRepository],
  exports: [OptOutsRepository],
})
export class OptOutsModule {}
