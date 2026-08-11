import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { SnsPublisherService } from '@bitcrm/shared';
import { CrmStatus, type Contact } from '@bitcrm/types';
import {
  createMockContact,
  createMockContactsRepository,
  createMockContactsCacheService,
  createMockSnsPublisherService,
} from '../mocks';

describe('ContactsService.merge', () => {
  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;
  let cache: ReturnType<typeof createMockContactsCacheService>;
  let snsPublisher: ReturnType<typeof createMockSnsPublisherService>;

  const primary = createMockContact({
    id: 'contact-1',
    phones: ['+14045551234'],
    emails: ['john@example.com'],
    addresses: [{ street: '123 Main St', city: 'Atlanta', state: 'GA', zip: '30301' }],
    notes: 'Primary notes',
  });
  const dupA = createMockContact({
    id: 'contact-2',
    phones: ['+14045551234', '+14045555678'],
    emails: ['John@Example.com', 'j.doe@work.com'],
    addresses: [
      // Same postal address as the primary's, differing only in case — must dedupe.
      { street: '123 main st', city: 'atlanta', state: 'ga', zip: '30301' },
      { street: '9 Peachtree Rd', city: 'Atlanta', state: 'GA', zip: '30305' },
    ],
    notes: 'Duplicate notes',
    companyId: 'company-9',
  });
  const dupB = createMockContact({
    id: 'contact-3',
    phones: ['+14045559999'],
    emails: [],
    addresses: [],
  });

  beforeEach(async () => {
    repository = createMockContactsRepository();
    cache = createMockContactsCacheService();
    snsPublisher = createMockSnsPublisherService();

    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: ContactsCacheService, useValue: cache },
        { provide: SnsPublisherService, useValue: snsPublisher },
      ],
    }).compile();

    service = module.get(ContactsService);
  });

  function mockContacts(...contacts: Contact[]) {
    repository.findById.mockImplementation((id: string) =>
      Promise.resolve(contacts.find((c) => c.id === id) ?? null),
    );
    repository.update.mockImplementation((id: string, attrs: Partial<Contact>) =>
      Promise.resolve({ ...(contacts.find((c) => c.id === id) as Contact), ...attrs }),
    );
  }

  it('unions phones, emails (case-insensitive), and addresses into the primary', async () => {
    mockContacts(primary, dupA, dupB);

    const result = await service.merge({
      primaryId: 'contact-1',
      mergeIds: ['contact-2', 'contact-3'],
    });

    expect(repository.update).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        phones: ['+14045551234', '+14045555678', '+14045559999'],
        emails: ['john@example.com', 'j.doe@work.com'],
        addresses: [primary.addresses[0], dupA.addresses[1]],
      }),
    );
    expect(result.phones).toEqual(['+14045551234', '+14045555678', '+14045559999']);
  });

  it('combines notes and adopts a companyId when the primary has none', async () => {
    mockContacts(primary, dupA);

    await service.merge({ primaryId: 'contact-1', mergeIds: ['contact-2'] });

    expect(repository.update).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({
        notes: 'Primary notes\n\nDuplicate notes',
        companyId: 'company-9',
      }),
    );
  });

  it('re-points phone index rows and soft-deletes the merged contacts', async () => {
    mockContacts(primary, dupA, dupB);

    await service.merge({ primaryId: 'contact-1', mergeIds: ['contact-2', 'contact-3'] });

    // Losers' PHONE# rows must be removed before the primary claims the numbers,
    // otherwise findByPhone can resolve to a soft-deleted contact.
    expect(repository.updatePhoneIndex).toHaveBeenCalledWith('contact-2', dupA.phones, []);
    expect(repository.updatePhoneIndex).toHaveBeenCalledWith('contact-3', dupB.phones, []);
    expect(repository.updatePhoneIndex).toHaveBeenCalledWith(
      'contact-1',
      primary.phones,
      ['+14045551234', '+14045555678', '+14045559999'],
    );
    expect(repository.update).toHaveBeenCalledWith('contact-2', { status: CrmStatus.DELETED });
    expect(repository.update).toHaveBeenCalledWith('contact-3', { status: CrmStatus.DELETED });
  });

  it('invalidates cache for every participant and publishes merge events', async () => {
    mockContacts(primary, dupA, dupB);

    await service.merge({ primaryId: 'contact-1', mergeIds: ['contact-2', 'contact-3'] });

    expect(cache.invalidate).toHaveBeenCalledWith('contact-1');
    expect(cache.invalidate).toHaveBeenCalledWith('contact-2');
    expect(cache.invalidate).toHaveBeenCalledWith('contact-3');
    expect(snsPublisher.publish).toHaveBeenCalledWith('crm', 'contact.merged', {
      oldContactId: 'contact-2',
      newContactId: 'contact-1',
    });
    expect(snsPublisher.publish).toHaveBeenCalledWith('crm', 'contact.merged', {
      oldContactId: 'contact-3',
      newContactId: 'contact-1',
    });
    expect(snsPublisher.publish).toHaveBeenCalledWith('crm', 'contact.updated', {
      contactId: 'contact-1',
    });
  });

  it('throws BadRequestException when primaryId appears in mergeIds', async () => {
    mockContacts(primary, dupA);

    await expect(
      service.merge({ primaryId: 'contact-1', mergeIds: ['contact-1', 'contact-2'] }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when a contact does not exist', async () => {
    mockContacts(primary);

    await expect(
      service.merge({ primaryId: 'contact-1', mergeIds: ['contact-404'] }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when a merged contact is already deleted', async () => {
    const deleted = createMockContact({ id: 'contact-2', status: CrmStatus.DELETED });
    mockContacts(primary, deleted);

    await expect(
      service.merge({ primaryId: 'contact-1', mergeIds: ['contact-2'] }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});
