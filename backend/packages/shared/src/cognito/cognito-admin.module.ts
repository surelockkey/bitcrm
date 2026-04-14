import { Global, Module } from '@nestjs/common';
import { CognitoAdminService } from './cognito-admin.service';

@Global()
@Module({
  providers: [CognitoAdminService],
  exports: [CognitoAdminService],
})
export class CognitoAdminModule {}
