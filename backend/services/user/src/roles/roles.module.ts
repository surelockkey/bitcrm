import { Module, forwardRef } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { RolesRepository } from './roles.repository';
import { RolesCacheService } from './roles-cache.service';
import { PermissionResolverService } from './permission-resolver.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [forwardRef(() => UsersModule)],
  controllers: [RolesController],
  providers: [
    RolesService,
    RolesRepository,
    RolesCacheService,
    PermissionResolverService,
  ],
  exports: [RolesService, RolesRepository, RolesCacheService, PermissionResolverService],
})
export class RolesModule {}
