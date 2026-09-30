import { Global, Module } from '@nestjs/common';
import {
  ContainerUsersController,
  UserContainersController,
} from './user-containers.controller';
import { UserContainersService } from './user-containers.service';
import { UserContainersRepository } from './user-containers.repository';
import { ContainerAssignmentResolver } from './container-assignment.resolver';
import { ContainersRepository } from '../containers/containers.repository';

/**
 * Global: ContainersService, TransfersService and the Stock popup (StockModule)
 * all ask the resolver which container a user works from, and none of them
 * should import a module for it. Nothing here imports them back:
 * ContainersRepository is listed as this module's own provider (it is
 * stateless) instead of importing ContainersModule, which depends on the
 * resolver.
 */
@Global()
@Module({
  controllers: [UserContainersController, ContainerUsersController],
  providers: [
    UserContainersService,
    UserContainersRepository,
    ContainerAssignmentResolver,
    ContainersRepository,
  ],
  exports: [UserContainersService, UserContainersRepository, ContainerAssignmentResolver],
})
export class UserContainersModule {}
