import { Module } from '@nestjs/common';
import { EMAIL_CODE_CONFIG, EMAIL_CODE_SES, EmailCodeSender, emailCodeConfigFromEnv, sesClientFromEnv } from './email-code.sender';
import { SecurityController } from './security.controller';
import { SecuritySettingsRepository } from './security-settings.repository';
import { SecurityService } from './security.service';

/**
 * Settings → Security Center: the account's security settings and the
 * sender for codes by email. `MfaModule` reads both at sign-in.
 *
 * Imported FIRST in `AppModule`: `GET /users/security-settings` must be
 * registered ahead of the users module's `GET /users/:id`, or Nest reads
 * "security-settings" as a user id.
 */
@Module({
  controllers: [SecurityController],
  providers: [
    SecurityService,
    SecuritySettingsRepository,
    EmailCodeSender,
    { provide: EMAIL_CODE_CONFIG, useFactory: emailCodeConfigFromEnv },
    { provide: EMAIL_CODE_SES, useFactory: sesClientFromEnv },
  ],
  exports: [SecurityService, EmailCodeSender],
})
export class SecurityModule {}
