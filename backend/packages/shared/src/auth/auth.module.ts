import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CognitoAuthGuard } from './auth.guard';
import { PermissionGuard } from './permission.guard';
import { PermissionCacheReader } from './permission-cache-reader';

@Global()
@Module({
  providers: [
    PermissionCacheReader,
    {
      provide: APP_GUARD,
      useClass: CognitoAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
  ],
  exports: [PermissionCacheReader],
})
export class AuthModule {}
