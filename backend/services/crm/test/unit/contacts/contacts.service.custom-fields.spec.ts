import { Test } from '@nestjs/testing';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { ClientCustomFieldsCatalog } from 'src/contacts/client-custom-fields.catalog';
import { ContactType, ContactSource } from '@bitcrm/types';
import { createMockContact, createMockContactsRepository, createMockContactsCacheService } from '../mocks';

/**
 * Workiz's client custom fields (Settings → Custom Fields → Client; the
 * client page's "Custom fields" tab): answers stored on the contact, keyed by
 * definition id, checked against the client catalog — CRM has no
 * ValidationPipe, so the service is the check.
 */
describe('ContactsService — client custom fields', () => {
  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;
  let catalog: { list: jest.Mock };
  const caller = { id: 'admin-1', cognitoSub: 's', email: 'a@t.com', roleId: 'r', department: 'HQ' };
  const dto = {
    firstName: 'Grata',
    lastName: 'Smart Living',
    phones: ['(505) 228-5946'],
    type: ContactType.RESIDENTIAL,
    source: ContactSource.MANUAL,
  };
  const defs = [
    { id: 'cf-vendor', name: 'Vendor Number 1', type: 'text', active: true, searchable: true, options: [] },
    {
      id: 'cf-platinum',
      name: 'Platinum Company name',
      type: 'dropdown',
      active: true,
      searchable: true,
      options: ['Sure Lock & Key', 'DBA'],
    },
    { id: 'cf-wo', name: 'Work Order', type: 'file', active: true, searchable: false, options: [] },
    { id: 'cf-old', name: 'Old field', type: 'text', active: false, searchable: false, options: [] },
  ];

  beforeEach(async () => {
    repository = createMockContactsRepository();
    repository.findByPhone.mockResolvedValue(null);
    repository.update.mockImplementation(async (id: string, attrs: object) => createMockContact({ id, ...attrs }));
    catalog = { list: jest.fn().mockResolvedValue(defs) };
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: ContactsCacheService, useValue: createMockContactsCacheService() },
        { provide: ClientCustomFieldsCatalog, useValue: catalog },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  describe('create', () => {
    it('stores the answers, blank ones left out', async () => {
      const contact = await service.create(
        { ...dto, customFields: { 'cf-vendor': '707748', 'cf-platinum': 'DBA', 'cf-wo': [] } } as never,
        caller as never,
      );

      expect(contact.customFields).toEqual({ 'cf-vendor': '707748', 'cf-platinum': 'DBA' });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ customFields: { 'cf-vendor': '707748', 'cf-platinum': 'DBA' } }),
      );
    });

    it('asks nothing of the catalog when no answers come', async () => {
      const contact = await service.create(dto as never, caller as never);
      expect(contact.customFields).toBeUndefined();
      expect(catalog.list).not.toHaveBeenCalled();
    });

    it.each([
      ['a job field (or any id that is not a client field)', { 'cf-job': 'x' }, /Unknown or inactive client custom field cf-job/],
      ['an archived client field', { 'cf-old': 'x' }, /cf-old/],
      ['a choice the drop-down does not offer', { 'cf-platinum': 'Acme' }, /Platinum Company name/],
      ['a number for a text field', { 'cf-vendor': 707748 }, /Vendor Number 1/],
      ['more than five files', { 'cf-wo': ['1', '2', '3', '4', '5', '6'] }, /Work Order/],
    ])('refuses %s (400)', async (_label, customFields, message) => {
      const error = await service.create({ ...dto, customFields } as never, caller as never).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toMatch(message);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses answers that are not keyed by field id', async () => {
      await expect(
        service.create({ ...dto, customFields: ['707748'] } as never, caller as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('asks the catalog afresh before calling a field unknown — it may be a minute old', async () => {
      catalog.list
        .mockResolvedValueOnce(defs)
        .mockResolvedValueOnce([...defs, { id: 'cf-new', name: 'Drive link', type: 'text', active: true, searchable: false, options: [] }]);

      const contact = await service.create({ ...dto, customFields: { 'cf-new': 'https://x' } } as never, caller as never);

      expect(catalog.list).toHaveBeenLastCalledWith({ fresh: true });
      expect(contact.customFields).toEqual({ 'cf-new': 'https://x' });
    });
  });

  describe('update', () => {
    const stored = createMockContact({
      id: 'contact-1',
      customFields: { 'cf-vendor': '707748', 'cf-platinum': 'Sure Lock & Key', 'workiz:f21': 'Jason' },
    });

    beforeEach(() => repository.findById.mockResolvedValue(stored));

    it('merges the answers sent onto the stored ones; a blank one clears its field', async () => {
      await service.update('contact-1', { customFields: { 'cf-platinum': 'DBA', 'cf-vendor': '' } } as never);

      expect(repository.update).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({ customFields: { 'cf-platinum': 'DBA', 'workiz:f21': 'Jason' } }),
      );
    });

    it('a null clears a field too', async () => {
      await service.update('contact-1', { customFields: { 'cf-platinum': null } } as never);
      expect(repository.update).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({ customFields: { 'cf-vendor': '707748', 'workiz:f21': 'Jason' } }),
      );
    });

    it('leaves the answers alone (and the catalog unasked) when none are sent', async () => {
      await service.update('contact-1', { firstName: 'Grata' } as never);
      expect(repository.update.mock.calls[0][1]).not.toHaveProperty('customFields');
      expect(catalog.list).not.toHaveBeenCalled();
    });

    it('writes nothing when the catalog cannot be read (502)', async () => {
      catalog.list.mockRejectedValue(new BadGatewayException('deal down'));
      await expect(
        service.update('contact-1', { customFields: { 'cf-vendor': '1' } } as never),
      ).rejects.toThrow(BadGatewayException);
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  it('asks the contacts table whether a client field is still answered (archive or delete)', async () => {
    repository.isCustomFieldAnswered.mockResolvedValue(true);
    expect(await service.isCustomFieldAnswered('cf-vendor')).toBe(true);
    expect(repository.isCustomFieldAnswered).toHaveBeenCalledWith('cf-vendor');
  });

  describe('merge', () => {
    it("keeps the primary's answers and takes the duplicate's for the fields the primary left blank", async () => {
      const primary = createMockContact({ id: 'p', customFields: { 'cf-vendor': '1' } });
      const dup = createMockContact({
        id: 'd',
        phones: ['+14045550000'],
        customFields: { 'cf-vendor': '2', 'cf-platinum': 'DBA' },
      });
      repository.findById.mockImplementation(async (id: string) => (id === 'p' ? primary : dup));

      await service.merge({ primaryId: 'p', mergeIds: ['d'] } as never);

      expect(repository.update).toHaveBeenCalledWith(
        'p',
        expect.objectContaining({ customFields: { 'cf-vendor': '1', 'cf-platinum': 'DBA' } }),
      );
    });
  });
});
