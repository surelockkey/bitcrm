import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompaniesRepository } from './companies.repository';
import { CompaniesCacheService } from './companies-cache.service';
import { CompanyDocumentsController } from './documents/company-documents.controller';
import { CompanyDocumentsService } from './documents/company-documents.service';
import { CompanyDocumentsRepository } from './documents/company-documents.repository';

@Module({
  imports: [ContactsModule],
  // Documents controller before Companies so `/:id/documents` isn't shadowed.
  controllers: [CompanyDocumentsController, CompaniesController],
  providers: [
    CompaniesService,
    CompaniesRepository,
    CompaniesCacheService,
    CompanyDocumentsService,
    CompanyDocumentsRepository,
  ],
  exports: [CompaniesService],
})
export class CompaniesModule {}
