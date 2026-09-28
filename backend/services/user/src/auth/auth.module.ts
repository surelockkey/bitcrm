import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaModule } from '../mfa/mfa.module';

@Module({
  imports: [MfaModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
