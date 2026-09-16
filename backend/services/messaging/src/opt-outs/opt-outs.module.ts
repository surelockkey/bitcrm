import { Module } from '@nestjs/common';
import { OptOutsRepository } from './opt-outs.repository';
import { OptOutsService } from './opt-outs.service';
import { OptOutsController } from './opt-outs.controller';

@Module({
  controllers: [OptOutsController],
  providers: [OptOutsRepository, OptOutsService],
  exports: [OptOutsRepository, OptOutsService],
})
export class OptOutsModule {}
