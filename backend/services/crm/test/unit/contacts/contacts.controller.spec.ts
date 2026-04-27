import { Test } from '@nestjs/testing';
import { ContactsController } from 'src/contacts/contacts.controller';
import { ContactsService } from 'src/contacts/contacts.service';
import { createMockContact, createMockJwtUser } from '../mocks';
import { ContactType, ContactSource } from '@bitcrm/types';

describe('ContactsController', () => {
  let controller: ContactsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      searchByPhone: jest.fn(),
      findOrCreate: jest.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: service }],
    }).compile();

    controller = module.get(ContactsController);
  });

  describe('create', () => {
    it('should return success wrapper with created contact', async () => {
      const contact = createMockContact();
      const caller = createMockJwtUser();
      const dto = {
        firstName: 'John', lastName: 'Doe',
        phones: ['(404) 555-1234'], emails: [],
        type: ContactType.RESIDENTIAL, source: ContactSource.MANUAL,
      };
      service.create.mockResolvedValue(contact);

      const result = await controller.create(dto as any, caller);

      expect(result).toEqual({ success: true, data: contact });
      expect(service.create).toHaveBeenCalledWith(dto, caller);
    });
  });

  describe('list', () => {
    it('should return paginated contacts', async () => {
      const contacts = [createMockContact()];
      service.list.mockResolvedValue({ items: contacts, nextCursor: undefined });

      const result = await controller.list({ limit: 20 } as any);

      expect(result).toEqual({
        success: true,
        data: contacts,
        pagination: { nextCursor: undefined, count: 1 },
      });
    });
  });

  describe('findById', () => {
    it('should return success wrapper with contact', async () => {
      const contact = createMockContact();
      service.findById.mockResolvedValue(contact);

      const result = await controller.findById('contact-1');

      expect(result).toEqual({ success: true, data: contact });
      expect(service.findById).toHaveBeenCalledWith('contact-1');
    });
  });

  describe('update', () => {
    it('should return success wrapper with updated contact', async () => {
      const contact = createMockContact({ firstName: 'Jane' });
      service.update.mockResolvedValue(contact);

      const result = await controller.update('contact-1', { firstName: 'Jane' } as any);

      expect(result).toEqual({ success: true, data: contact });
      expect(service.update).toHaveBeenCalledWith('contact-1', { firstName: 'Jane' });
    });
  });

  describe('delete', () => {
    it('should return success wrapper with deleted indicator', async () => {
      service.delete.mockResolvedValue(undefined);

      const result = await controller.delete('contact-1');

      expect(result).toEqual({ success: true, data: { id: 'contact-1', deleted: true } });
      expect(service.delete).toHaveBeenCalledWith('contact-1');
    });
  });

  describe('searchByPhone', () => {
    it('should return contacts matching phone', async () => {
      const contact = createMockContact();
      service.searchByPhone.mockResolvedValue(contact);

      const result = await controller.searchByPhone('(404) 555-1234');

      expect(result).toEqual({ success: true, data: contact });
      expect(service.searchByPhone).toHaveBeenCalledWith('(404) 555-1234');
    });

    it('should return null when no match', async () => {
      service.searchByPhone.mockResolvedValue(null);

      const result = await controller.searchByPhone('(999) 999-9999');

      expect(result).toEqual({ success: true, data: null });
    });
  });

  describe('findOrCreate', () => {
    it('should return existing contact with created=false', async () => {
      const contact = createMockContact();
      service.findOrCreate.mockResolvedValue({ contact, created: false });

      const result = await controller.findOrCreate({
        phone: '(404) 555-1234', firstName: 'John', lastName: 'Doe',
      } as any);

      expect(result).toEqual({ success: true, data: { contact, created: false } });
    });

    it('should return new contact with created=true', async () => {
      const contact = createMockContact();
      service.findOrCreate.mockResolvedValue({ contact, created: true });

      const result = await controller.findOrCreate({
        phone: '(404) 555-1234', firstName: 'John', lastName: 'Doe',
      } as any);

      expect(result).toEqual({ success: true, data: { contact, created: true } });
    });
  });
});
