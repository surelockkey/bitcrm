import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsRepository } from './assets.repository';
import { AssetsService } from './assets.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsRepository, AssetsService],
  exports: [AssetsRepository, AssetsService],
})
export class AssetsModule {}
