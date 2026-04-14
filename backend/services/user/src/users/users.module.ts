import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersCacheService } from './users-cache.service';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [forwardRef(() => RolesModule)],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, UsersCacheService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
