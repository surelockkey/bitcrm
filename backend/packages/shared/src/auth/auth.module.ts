import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CognitoAuthGuard } from './auth.guard';
import { PermissionGuard } from './permission.guard';
import { PermissionCacheReader } from './permission-cache-reader';
import { UserActivityTracker } from './user-activity';

@Global()
@Module({
  providers: [
    PermissionCacheReader,
    UserActivityTracker,
    {
      provide: APP_GUARD,
      useClass: CognitoAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
  ],
  exports: [PermissionCacheReader, UserActivityTracker],
})
export class AuthModule {}
