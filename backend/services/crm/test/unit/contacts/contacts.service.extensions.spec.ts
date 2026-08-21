import { Test } from '@nestjs/testing';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { ContactType, ContactSource } from '@bitcrm/types';
import {
  createMockContact,
  createMockContactsRepository,
  createMockContactsCacheService,
  createMockJwtUser,
} from '../mocks';

/**
 * An extension is the keys somebody presses once the call is answered. It is
 * stored keyed by the number it belongs to, so the whole risk is the key: it
 * has to follow the same normalization the phone list gets, and it has to
 * disappear with the number it was attached to.
 */
describe('ContactsService — phone extensions', () => {
  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;
  const caller = createMockJwtUser();

  beforeEach(async () => {
    repository = createMockContactsRepository();
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: ContactsCacheService, useValue: createMockContactsCacheService() },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  describe('create', () => {
    const dto = {
      firstName: 'John',
      lastName: 'Doe',
      phones: ['(404) 555-1234'],
      emails: [],
      type: ContactType.RESIDENTIAL,
      source: ContactSource.MANUAL,
    };

    it('keys the extension by the normalized phone', async () => {
      repository.findByPhone.mockResolvedValue(null);

      const result = await service.create(
        { ...dto, phoneExtensions: { '(404) 555-1234': 'ext. 102' } } as never,
        caller,
      );

      expect(result.phoneExtensions).toEqual({ '+14045551234': '102' });
    });

    it('drops an extension for a number the contact does not have', async () => {
      repository.findByPhone.mockResolvedValue(null);

      const result = await service.create(
        { ...dto, phoneExtensions: { '+15558675309': '7' } } as never,
        caller,
      );

      expect(result.phoneExtensions).toEqual({});
    });
  });

  describe('update', () => {
    it('re-keys extensions against the phones being saved', async () => {
      const existing = createMockContact({ phones: ['+14045551234'] });
      repository.findById.mockResolvedValue(existing);
      repository.findByPhone.mockResolvedValue(null);
      repository.update.mockResolvedValue(existing);

      await service.update('contact-1', {
        phones: ['(404) 555-1234'],
        phoneExtensions: { '404-555-1234': '102' },
      } as never);

      expect(repository.update).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({ phoneExtensions: { '+14045551234': '102' } }),
      );
    });

    it('lets go of the extension when its number is removed', async () => {
      const existing = createMockContact({
        phones: ['+14045551234', '+15558675309'],
        phoneExtensions: { '+15558675309': '7' },
      });
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue(existing);

      await service.update('contact-1', {
        phones: ['+14045551234'],
        phoneExtensions: { '+15558675309': '7' },
      } as never);

      expect(repository.update).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({ phoneExtensions: {} }),
      );
    });

    it('keeps the stored extensions when the edit does not mention them', async () => {
      const existing = createMockContact({
        phones: ['+14045551234'],
        phoneExtensions: { '+14045551234': '102' },
      });
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue(existing);

      await service.update('contact-1', { firstName: 'Jane' } as never);

      const attrs = repository.update.mock.calls[0][1];
      expect(attrs.phoneExtensions).toBeUndefined();
    });
  });

  describe('merge', () => {
    it('carries the duplicates’ extensions onto the surviving contact', async () => {
      const primary = createMockContact({
        id: 'contact-1',
        phones: ['+14045551234'],
        phoneExtensions: { '+14045551234': '102' },
      });
      const duplicate = createMockContact({
        id: 'contact-2',
        phones: ['+15558675309'],
        phoneExtensions: { '+15558675309': '7' },
      });
      repository.findById.mockImplementation(async (id: string) =>
        id === 'contact-1' ? primary : duplicate,
      );
      repository.update.mockResolvedValue(primary);

      await service.merge({ primaryId: 'contact-1', mergeIds: ['contact-2'] } as never);

      expect(repository.update).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({
          phoneExtensions: { '+14045551234': '102', '+15558675309': '7' },
        }),
      );
    });

    it('keeps the primary’s extension when both sides have one for a number', async () => {
      const primary = createMockContact({
        id: 'contact-1',
        phones: ['+14045551234'],
        phoneExtensions: { '+14045551234': '102' },
      });
      const duplicate = createMockContact({
        id: 'contact-2',
        phones: ['+14045551234'],
        phoneExtensions: { '+14045551234': '999' },
      });
      repository.findById.mockImplementation(async (id: string) =>
        id === 'contact-1' ? primary : duplicate,
      );
      repository.update.mockResolvedValue(primary);

      await service.merge({ primaryId: 'contact-1', mergeIds: ['contact-2'] } as never);

      expect(repository.update).toHaveBeenCalledWith(
        'contact-1',
        expect.objectContaining({ phoneExtensions: { '+14045551234': '102' } }),
      );
    });
  });
});
