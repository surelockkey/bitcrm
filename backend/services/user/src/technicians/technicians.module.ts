import { Module, forwardRef } from '@nestjs/common';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { TechniciansRepository } from './technicians.repository';
import { TechniciansCacheService } from './technicians-cache.service';
import { TechnicianAssignmentsController } from './assignments/technician-assignments.controller';
import { TechnicianAssignmentsService } from './assignments/technician-assignments.service';
import { TechnicianAssignmentsRepository } from './assignments/technician-assignments.repository';
import { CommissionController } from './commission/commission.controller';
import { CommissionService } from './commission/commission.service';
import { CommissionRepository } from './commission/commission.repository';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { DocumentsRepository } from './documents/documents.repository';
import { SensitiveService } from './documents/sensitive.service';
import { SensitiveRepository } from './documents/sensitive.repository';
import { AuditRepository } from './documents/audit.repository';
import { TechnicianLocationController } from './location/technician-location.controller';
import { TechnicianLocationService } from './location/technician-location.service';
import { RolesModule } from '../roles/roles.module';

@Module({
  imports: [forwardRef(() => RolesModule)],
  controllers: [
    TechnicianAssignmentsController,
    CommissionController,
    DocumentsController,
    TechnicianLocationController,
    TechniciansController,
  ],
  providers: [
    TechniciansService,
    TechniciansRepository,
    TechniciansCacheService,
    TechnicianAssignmentsService,
    TechnicianAssignmentsRepository,
    CommissionService,
    CommissionRepository,
    DocumentsService,
    DocumentsRepository,
    SensitiveService,
    SensitiveRepository,
    AuditRepository,
    TechnicianLocationService,
  ],
  exports: [
    TechniciansService,
    TechniciansRepository,
    TechnicianAssignmentsRepository,
    TechnicianAssignmentsService,
    CommissionRepository,
  ],
})
export class TechniciansModule {}
