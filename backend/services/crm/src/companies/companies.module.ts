import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompaniesRepository } from './companies.repository';
import { CompaniesCacheService } from './companies-cache.service';

@Module({
  imports: [ContactsModule],
  controllers: [CompaniesController],
  providers: [CompaniesService, CompaniesRepository, CompaniesCacheService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
