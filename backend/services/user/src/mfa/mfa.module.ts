import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { TWILIO_VERIFY_CONFIG, TwilioVerifyClient, twilioVerifyConfigFromEnv } from './twilio-verify.client';

/** Two-step sign-in by SMS: the login gate, and the switches for it. */
@Module({
  imports: [forwardRef(() => UsersModule)],
  controllers: [MfaController],
  providers: [
    MfaService,
    TwilioVerifyClient,
    { provide: TWILIO_VERIFY_CONFIG, useFactory: twilioVerifyConfigFromEnv },
  ],
  exports: [MfaService],
})
export class MfaModule {}
