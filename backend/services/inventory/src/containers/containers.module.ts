import { Module } from '@nestjs/common';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';
import { ContainersRepository } from './containers.repository';

@Module({
  controllers: [ContainersController],
  providers: [ContainersService, ContainersRepository],
  exports: [ContainersService, ContainersRepository],
})
export class ContainersModule {}
