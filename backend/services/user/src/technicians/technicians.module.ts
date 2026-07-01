import { Module, forwardRef } from '@nestjs/common';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { TechniciansRepository } from './technicians.repository';
import { TechniciansCacheService } from './technicians-cache.service';
import { TechnicianSkillsController } from './skills/technician-skills.controller';
import { TechnicianSkillsService } from './skills/technician-skills.service';
import { TechnicianSkillsRepository } from './skills/technician-skills.repository';
import { CommissionController } from './commission/commission.controller';
import { CommissionService } from './commission/commission.service';
import { CommissionRepository } from './commission/commission.repository';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { DocumentsRepository } from './documents/documents.repository';
import { SensitiveService } from './documents/sensitive.service';
import { SensitiveRepository } from './documents/sensitive.repository';
import { AuditRepository } from './documents/audit.repository';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [forwardRef(() => RolesModule)],
  controllers: [
    TechnicianSkillsController,
    CommissionController,
    DocumentsController,
    TechniciansController,
  ],
  providers: [
    TechniciansService,
    TechniciansRepository,
    TechniciansCacheService,
    TechnicianSkillsService,
    TechnicianSkillsRepository,
    CommissionService,
    CommissionRepository,
    DocumentsService,
    DocumentsRepository,
    SensitiveService,
    SensitiveRepository,
    AuditRepository,
  ],
  exports: [
    TechniciansService,
    TechniciansRepository,
    TechnicianSkillsRepository,
    CommissionRepository,
  ],
})
export class TechniciansModule {}
