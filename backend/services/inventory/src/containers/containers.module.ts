import { Module } from '@nestjs/common';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';
import { ContainersRepository } from './containers.repository';
import { ContainerTemplatesRepository } from '../container-templates/container-templates.repository';

@Module({
  controllers: [ContainersController],
  // ContainerTemplatesRepository (stateless) validates `templateId`; importing
  // ContainerTemplatesModule instead would pull TransfersModule in.
  providers: [ContainersService, ContainersRepository, ContainerTemplatesRepository],
  exports: [ContainersService, ContainersRepository],
})
export class ContainersModule {}
