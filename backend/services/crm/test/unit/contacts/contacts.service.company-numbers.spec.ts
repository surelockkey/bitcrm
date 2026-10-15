import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { CompanyNumbersCatalog } from 'src/contacts/company-numbers.catalog';
import { ContactSource, ContactType } from '@bitcrm/types';
import { createMockContact, createMockContactsCacheService, createMockContactsRepository } from '../mocks';

/**
 * A client record must never carry one of the company's own Twilio numbers:
 * texting the client then makes Twilio pick that number as the sender too and
 * refuse with 21266 ("'To' and 'From' cannot be the same"). crm refuses such
 * a number on create, on update (when it is added) and on the call path's
 * find-or-create. Telephony unreachable → allowed (the catalog fails open).
 */
describe('ContactsService — company phone numbers', () => {
  const OWN = '+14098777774';
  const caller = { id: 'admin-1', cognitoSub: 's', email: 'a@t.com', roleId: 'r', department: 'HQ' };
  const dto = {
    firstName: 'Lily',
    lastName: 'Test',
    phones: ['(409) 877-7774', '(203) 456-7865'],
    type: ContactType.RESIDENTIAL,
    source: ContactSource.MANUAL,
  };

  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;
  let cache: ReturnType<typeof createMockContactsCacheService>;
  let numbers: { numbers: jest.Mock };

  beforeEach(async () => {
    repository = createMockContactsRepository();
    repository.findByPhone.mockResolvedValue(null);
    repository.update.mockImplementation(async (id: string, attrs: object) => createMockContact({ id, ...attrs }));
    cache = createMockContactsCacheService();
    numbers = { numbers: jest.fn().mockResolvedValue(new Set([OWN])) };
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: ContactsCacheService, useValue: cache },
        { provide: CompanyNumbersCatalog, useValue: numbers },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  describe('create', () => {
    it("400s on a phone that is one of the company's numbers — nothing written", async () => {
      const err = await service.create(dto as never, caller as never).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe("+14098777774 is one of the company's phone numbers");
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses it on the screen-pop "create from call" path too (source phone_call, reassignPhones)', async () => {
      const fromCall = { ...dto, phones: ['+14098777774'], source: ContactSource.PHONE_CALL, reassignPhones: true };
      await expect(service.create(fromCall as never, caller as never)).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.updatePhoneIndex).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('creates the contact when none of its phones are ours', async () => {
      await service.create({ ...dto, phones: ['(203) 456-7865'] } as never, caller as never);
      expect(repository.create).toHaveBeenCalled();
    });

    it('fails open: an empty catalog (telephony unreachable) refuses nothing', async () => {
      numbers.numbers.mockResolvedValue(new Set());
      await service.create(dto as never, caller as never);
      expect(repository.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('400s when a company number is added', async () => {
      cache.get.mockResolvedValue(createMockContact({ id: 'ct1', phones: ['+12034567865'] }));
      const err = await service.update('ct1', { phones: ['+12034567865', '409-877-7774'] } as never).catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe("+14098777774 is one of the company's phone numbers");
      expect(repository.updatePhoneIndex).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('does not block other edits of a contact that already carries one (legacy data)', async () => {
      cache.get.mockResolvedValue(createMockContact({ id: 'ct1', phones: [OWN, '+12034567865'] }));
      await service.update('ct1', { phones: [OWN, '+12034567865'], firstName: 'Lily' } as never);
      expect(repository.update).toHaveBeenCalled();
    });
  });

  describe('findOrCreate (a contact from a call)', () => {
    it('never creates a contact for one of our own numbers (a call between two of our lines)', async () => {
      await expect(
        service.findOrCreate({ phone: '+14098777774', source: ContactSource.PHONE_CALL } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });
});
