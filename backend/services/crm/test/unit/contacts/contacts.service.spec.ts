import { Test } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { SnsPublisherService } from '@bitcrm/shared';
import { ContactType, ContactSource, CrmStatus } from '@bitcrm/types';
import {
  createMockContact,
  createMockContactsRepository,
  createMockContactsCacheService,
  createMockSnsPublisherService,
} from '../mocks';

describe('ContactsService', () => {
  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;
  let cache: ReturnType<typeof createMockContactsCacheService>;
  let snsPublisher: ReturnType<typeof createMockSnsPublisherService>;

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

  describe('create', () => {
    const dto = {
      firstName: 'John', lastName: 'Doe',
      phones: ['(404) 555-1234'], emails: ['john@example.com'],
      type: ContactType.RESIDENTIAL, source: ContactSource.MANUAL,
    };
    const caller = { id: 'admin-1', cognitoSub: 'sub', email: 'admin@test.com', roleId: 'role-admin', department: 'HQ' };

    it('should normalize phones, create contact, and publish event', async () => {
      repository.findByPhone.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      const result = await service.create(dto as any, caller);

      expect(result.firstName).toBe('John');
      expect(result.phones).toEqual(['+14045551234']);
      expect(result.status).toBe(CrmStatus.ACTIVE);
      expect(result.createdBy).toBe('admin-1');
      expect(repository.findByPhone).toHaveBeenCalledWith('+14045551234');
      expect(repository.create).toHaveBeenCalled();
      expect(snsPublisher.publish).toHaveBeenCalledWith(
        'crm', 'contact.created', expect.objectContaining({ contactId: result.id }),
      );
    });

    it('should throw ConflictException if phone already exists', async () => {
      const existing = createMockContact();
      repository.findByPhone.mockResolvedValue(existing);

      await expect(service.create(dto as any, caller)).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('should return cached contact on cache hit', async () => {
      const contact = createMockContact();
      cache.get.mockResolvedValue(contact);

      const result = await service.findById('contact-1');

      expect(result).toEqual(contact);
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('should fetch from repo on cache miss and populate cache', async () => {
      const contact = createMockContact();
      cache.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(contact);

      const result = await service.findById('contact-1');

      expect(result).toEqual(contact);
      expect(repository.findById).toHaveBeenCalledWith('contact-1');
      expect(cache.set).toHaveBeenCalledWith(contact);
    });

    it('should throw NotFoundException when not found', async () => {
      cache.get.mockResolvedValue(null);
      repository.findById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should delegate to repository with query params', async () => {
      const contacts = [createMockContact()];
      repository.findAll.mockResolvedValue({ items: contacts, nextCursor: undefined });

      const result = await service.list({ limit: 20 });

      expect(result).toEqual({ items: contacts, nextCursor: undefined });
      expect(repository.findAll).toHaveBeenCalledWith(20, undefined);
    });

    it('should use findByCompany when companyId provided', async () => {
      const contacts = [createMockContact({ companyId: 'company-1' })];
      repository.findByCompany.mockResolvedValue({ items: contacts, nextCursor: undefined });

      const result = await service.list({ companyId: 'company-1', limit: 20 });

      expect(repository.findByCompany).toHaveBeenCalledWith('company-1', 20, undefined);
    });
  });

  describe('update', () => {
    it('should update contact, invalidate cache, and publish event', async () => {
      const existing = createMockContact();
      const updated = createMockContact({ firstName: 'Jane' });
      cache.get.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('contact-1', { firstName: 'Jane' } as any);

      expect(result).toEqual(updated);
      expect(cache.invalidate).toHaveBeenCalledWith('contact-1');
      expect(snsPublisher.publish).toHaveBeenCalledWith(
        'crm', 'contact.updated', expect.objectContaining({ contactId: 'contact-1' }),
      );
    });

    it('should normalize and update phone index when phones change', async () => {
      const existing = createMockContact({ phones: ['+14045551234'] });
      const updated = createMockContact({ phones: ['+15558675309'] });
      cache.get.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);
      repository.updatePhoneIndex.mockResolvedValue(undefined);

      await service.update('contact-1', { phones: ['(555) 867-5309'] } as any);

      expect(repository.updatePhoneIndex).toHaveBeenCalledWith(
        'contact-1', ['+14045551234'], ['+15558675309'],
      );
    });
  });

  describe('delete', () => {
    it('should soft-delete by setting status to DELETED', async () => {
      const existing = createMockContact();
      cache.get.mockResolvedValue(existing);
      repository.update.mockResolvedValue({ ...existing, status: CrmStatus.DELETED });

      await service.delete('contact-1');

      expect(repository.update).toHaveBeenCalledWith('contact-1', { status: CrmStatus.DELETED });
      expect(cache.invalidate).toHaveBeenCalledWith('contact-1');
    });
  });

  describe('searchByPhone', () => {
    it('should normalize phone and delegate to repository', async () => {
      const contact = createMockContact();
      repository.findByPhone.mockResolvedValue(contact);

      const result = await service.searchByPhone('(404) 555-1234');

      expect(result).toEqual(contact);
      expect(repository.findByPhone).toHaveBeenCalledWith('+14045551234');
    });

    it('should return null when no match', async () => {
      repository.findByPhone.mockResolvedValue(null);

      const result = await service.searchByPhone('(999) 999-9999');

      expect(result).toBeNull();
    });
  });

  describe('findOrCreate', () => {
    const dto = { phone: '(404) 555-1234', firstName: 'John', lastName: 'Doe' };

    it('should return existing contact when phone matches', async () => {
      const existing = createMockContact();
      repository.findByPhone.mockResolvedValue(existing);

      const result = await service.findOrCreate(dto as any);

      expect(result).toEqual({ contact: existing, created: false });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should create new contact when phone not found', async () => {
      repository.findByPhone.mockResolvedValue(null);
      repository.create.mockResolvedValue(undefined);

      const result = await service.findOrCreate(dto as any);

      expect(result.created).toBe(true);
      expect(result.contact.firstName).toBe('John');
      expect(result.contact.phones).toEqual(['+14045551234']);
      expect(repository.create).toHaveBeenCalled();
    });
  });
});
