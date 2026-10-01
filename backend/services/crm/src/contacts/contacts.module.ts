import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';
import { ContactsCacheService } from './contacts-cache.service';
import { CompaniesRepository } from '../companies/companies.repository';
import { ContactNotesController } from './notes/contact-notes.controller';
import { ContactNotesService } from './notes/contact-notes.service';
import { ContactNotesRepository } from './notes/contact-notes.repository';

@Module({
  // Notes controller before Contacts so nothing under `/contacts/:id/notes`
  // is shadowed by the parameter routes (`GET :id`, `GET internal/:id`).
  controllers: [ContactNotesController, ContactsController],
  // CompaniesRepository is provided rather than imported: CompaniesModule
  // already imports this one, so importing it back would be circular. The
  // repository is stateless over DynamoDbService, so a second instance costs
  // nothing — it lets a phone lookup fall through to company main lines.
  providers: [
    ContactsService,
    ContactsRepository,
    ContactsCacheService,
    CompaniesRepository,
    ContactNotesService,
    ContactNotesRepository,
  ],
  exports: [ContactsService],
})
export class ContactsModule {}
