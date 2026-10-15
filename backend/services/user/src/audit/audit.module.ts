import { Global, Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller';
import { AdminAuditRepository } from './admin-audit.repository';
import { AdminAuditService } from './admin-audit.service';

/**
 * The admin trail. Global, so users, roles and MFA inject `AdminAuditService`
 * without importing this module — and imported FIRST in `AppModule`, so
 * `GET /api/users/audit` is registered ahead of the users module's
 * `GET /api/users/:id`.
 */
@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [AdminAuditService, AdminAuditRepository],
  exports: [AdminAuditService],
})
export class AuditModule {}
