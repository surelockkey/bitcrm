import { Module } from '@nestjs/common';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';
import { ContainersRepository } from './containers.repository';
import { ContainersEventHandler } from './containers.event-handler';

@Module({
  controllers: [ContainersController],
  providers: [ContainersService, ContainersRepository, ContainersEventHandler],
  exports: [ContainersService, ContainersRepository, ContainersEventHandler],
})
export class ContainersModule {}
