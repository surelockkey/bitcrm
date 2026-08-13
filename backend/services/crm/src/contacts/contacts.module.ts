import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';
import { ContactsCacheService } from './contacts-cache.service';
import { CompaniesRepository } from '../companies/companies.repository';

@Module({
  controllers: [ContactsController],
  // CompaniesRepository is provided rather than imported: CompaniesModule
  // already imports this one, so importing it back would be circular. The
  // repository is stateless over DynamoDbService, so a second instance costs
  // nothing — it lets a phone lookup fall through to company main lines.
  providers: [
    ContactsService,
    ContactsRepository,
    ContactsCacheService,
    CompaniesRepository,
  ],
  exports: [ContactsService],
})
export class ContactsModule {}
