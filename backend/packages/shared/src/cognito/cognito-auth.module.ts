import { Global, Module } from '@nestjs/common';
import { CognitoAuthService } from './cognito-auth.service';

@Global()
@Module({
  providers: [CognitoAuthService],
  exports: [CognitoAuthService],
})
export class CognitoAuthModule {}
