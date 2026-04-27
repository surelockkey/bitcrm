import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';
import { ContactsCacheService } from './contacts-cache.service';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, ContactsRepository, ContactsCacheService],
  exports: [ContactsService],
})
export class ContactsModule {}
