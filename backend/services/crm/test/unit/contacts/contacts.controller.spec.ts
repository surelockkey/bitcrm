import { Test } from '@nestjs/testing';
import { ContactsController } from 'src/contacts/contacts.controller';
import { ContactsService } from 'src/contacts/contacts.service';
import { createMockContact, createMockJwtUser } from '../mocks';
import { ContactType, ContactSource } from '@bitcrm/types';

/** A viewer holding contacts.view_numbers — the pre-masking status quo. */
const GRANTED = {
  roleId: 'role-admin',
  roleName: 'Admin',
  isSystemRole: true,
  permissions: { contacts: { view: true, view_numbers: true } },
  dataScope: {},
  dealStageTransitions: [],
  hasOverrides: false,
} as any;

describe('ContactsController', () => {
  let controller: ContactsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      merge: jest.fn(),
      delete: jest.fn(),
      searchByPhone: jest.fn(),
      findOrCreate: jest.fn(),
      findAll: jest.fn(),
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

      const result = await controller.list({ limit: 20 } as any, GRANTED);

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

      const result = await controller.findById('contact-1', GRANTED);

      expect(result).toEqual({ success: true, data: contact });
      expect(service.findById).toHaveBeenCalledWith('contact-1');
    });
  });

  describe('findByIdInternal', () => {
    it('should return success wrapper with contact', async () => {
      const contact = createMockContact();
      service.findById.mockResolvedValue(contact);

      const result = await controller.findByIdInternal('contact-1');

      expect(result).toEqual({ success: true, data: contact });
      expect(service.findById).toHaveBeenCalledWith('contact-1');
    });
  });

  describe('findAllInternal', () => {
    it('should return items and nextCursor wrapped in data', async () => {
      const contacts = [createMockContact()];
      service.findAll.mockResolvedValue({ items: contacts, nextCursor: 'next-1' });

      const result = await controller.findAllInternal('50', 'cursor-1');

      expect(result).toEqual({
        success: true,
        data: { items: contacts, nextCursor: 'next-1' },
      });
      expect(service.findAll).toHaveBeenCalledWith(50, 'cursor-1');
    });

    it('should default limit to 200 when not provided', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.findAllInternal(undefined, undefined);

      expect(service.findAll).toHaveBeenCalledWith(200, undefined);
    });

    it('should clamp limit to a max of 500', async () => {
      service.findAll.mockResolvedValue({ items: [], nextCursor: undefined });

      await controller.findAllInternal('1000', undefined);

      expect(service.findAll).toHaveBeenCalledWith(500, undefined);
    });
  });

  describe('update', () => {
    it('should return success wrapper with updated contact', async () => {
      const contact = createMockContact({ firstName: 'Jane' });
      service.update.mockResolvedValue(contact);

      const result = await controller.update('contact-1', { firstName: 'Jane' } as any, GRANTED);

      expect(result).toEqual({ success: true, data: contact });
      expect(service.update).toHaveBeenCalledWith('contact-1', { firstName: 'Jane' });
    });
  });

  describe('merge', () => {
    it('should return success wrapper with the merged contact', async () => {
      const contact = createMockContact();
      service.merge.mockResolvedValue(contact);
      const dto = { primaryId: 'contact-1', mergeIds: ['contact-2', 'contact-3'] };

      const result = await controller.merge(dto as any);

      expect(result).toEqual({ success: true, data: contact });
      expect(service.merge).toHaveBeenCalledWith(dto);
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

  /**
   * Call masking, from the controller's side: the grant is read off the
   * permissions the guard already resolved for `contacts.view`, and only the
   * user-facing routes redact. The internal routes must NOT — telephony
   * resolves the real number server-side to place the masked call.
   */
  describe('contacts.view_numbers', () => {
    const perms = (viewNumbers: boolean) =>
      ({
        roleId: 'role-technician',
        roleName: 'Technician',
        isSystemRole: true,
        permissions: { contacts: { view: true, view_numbers: viewNumbers } },
        dataScope: {},
        dealStageTransitions: [],
        hasOverrides: false,
      }) as any;

    it('list returns real numbers to a granted viewer', async () => {
      const contact = createMockContact({ phones: ['+14045551234'] });
      service.list.mockResolvedValue({ items: [contact], nextCursor: undefined });

      const result = await controller.list({ limit: 20 } as any, perms(true));

      expect(result.data[0].phones).toEqual(['+14045551234']);
      expect(result.data[0]).not.toHaveProperty('phonesMasked');
    });

    it('list hides numbers but keeps the count for a masked viewer', async () => {
      const contact = createMockContact({ phones: ['+14045551234'] });
      service.list.mockResolvedValue({ items: [contact], nextCursor: undefined });

      const result = await controller.list({ limit: 20 } as any, perms(false));

      expect(result.data[0].phones).toEqual([]);
      expect(result.data[0].phoneCount).toBe(1);
      expect(result.data[0].phonesMasked).toBe(true);
    });

    it('findById hides numbers for a masked viewer', async () => {
      service.findById.mockResolvedValue(
        createMockContact({ phones: ['+14045551234', '+14045555678'] }),
      );

      const result = await controller.findById('contact-1', perms(false));

      expect(result.data.phones).toEqual([]);
      expect(result.data.phoneCount).toBe(2);
    });

    it('fails closed when permissions could not be resolved', async () => {
      service.findById.mockResolvedValue(
        createMockContact({ phones: ['+14045551234'] }),
      );

      const result = await controller.findById('contact-1', undefined as any);

      expect(result.data.phones).toEqual([]);
    });

    it('never masks the internal by-id route', async () => {
      const contact = createMockContact({ phones: ['+14045551234'] });
      service.findById.mockResolvedValue(contact);

      const result = await controller.findByIdInternal('contact-1');

      expect(result.data.phones).toEqual(['+14045551234']);
    });

    /**
     * The destroy-on-edit trap: CRM has no whitelisting ValidationPipe, a
     * masked edit form loads `phones: []`, and `if (dto.phones)` is true for an
     * empty array — so without this the first unrelated save wipes every number.
     */
    it('drops phones from a masked caller update instead of blanking them', async () => {
      service.update.mockResolvedValue(createMockContact());

      await controller.update(
        'contact-1',
        { firstName: 'Jane', phones: [] } as any,
        perms(false),
      );

      expect(service.update).toHaveBeenCalledWith('contact-1', {
        firstName: 'Jane',
      });
    });

    it('passes phones through from a granted caller update', async () => {
      service.update.mockResolvedValue(createMockContact());

      await controller.update(
        'contact-1',
        { firstName: 'Jane', phones: ['+14045559999'] } as any,
        perms(true),
      );

      expect(service.update).toHaveBeenCalledWith('contact-1', {
        firstName: 'Jane',
        phones: ['+14045559999'],
      });
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
