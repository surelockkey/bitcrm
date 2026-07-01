import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { UsersCacheService } from './users-cache.service';
import { RolesModule } from '../roles/roles.module';
import { TechniciansModule } from '../technicians/technicians.module';

@Module({
  imports: [forwardRef(() => RolesModule), forwardRef(() => TechniciansModule)],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, UsersCacheService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
