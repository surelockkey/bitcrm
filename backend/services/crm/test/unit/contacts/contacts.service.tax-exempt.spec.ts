import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { ContactType, ContactSource } from '@bitcrm/types';
import {
  createMockContact,
  createMockContactsRepository,
  createMockContactsCacheService,
} from '../mocks';

/**
 * Tax exemption (billing): a tax-exempt client's new jobs/estimates carry no
 * tax. CRM has no global ValidationPipe, so the service checks the shape.
 */
describe('ContactsService — tax exemption', () => {
  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;
  let cache: ReturnType<typeof createMockContactsCacheService>;
  const caller = { id: 'admin-1', cognitoSub: 's', email: 'a@t.com', roleId: 'r', department: 'HQ' };
  const dto = {
    firstName: 'Ann',
    lastName: 'Lee',
    phones: ['(404) 555-1234'],
    type: ContactType.RESIDENTIAL,
    source: ContactSource.MANUAL,
  };

  beforeEach(async () => {
    repository = createMockContactsRepository();
    cache = createMockContactsCacheService();
    repository.findByPhone.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: ContactsCacheService, useValue: cache },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  it('stores taxExempt + reason on create', async () => {
    const contact = await service.create(
      { ...dto, taxExempt: true, taxExemptReason: '  Non-profit ' } as never,
      caller as never,
    );
    expect(contact.taxExempt).toBe(true);
    expect(contact.taxExemptReason).toBe('Non-profit');
    expect(repository.create.mock.calls[0][0]).toMatchObject({ taxExempt: true, taxExemptReason: 'Non-profit' });
  });

  it('defaults to not exempt on create', async () => {
    const contact = await service.create(dto as never, caller as never);
    expect(contact.taxExempt).toBe(false);
  });

  it('rejects a non-boolean taxExempt', async () => {
    await expect(
      service.create({ ...dto, taxExempt: 'yes' } as never, caller as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a reason longer than 200 characters', async () => {
    await expect(
      service.create({ ...dto, taxExemptReason: 'x'.repeat(201) } as never, caller as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates taxExempt and reason', async () => {
    cache.get.mockResolvedValue(createMockContact());
    repository.update.mockResolvedValue(createMockContact({ taxExempt: true }));
    await service.update('contact-1', { taxExempt: true, taxExemptReason: 'Gov' } as never);
    expect(repository.update).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({ taxExempt: true, taxExemptReason: 'Gov' }),
    );
  });

  it('rejects an invalid taxExempt on update', async () => {
    cache.get.mockResolvedValue(createMockContact());
    await expect(
      service.update('contact-1', { taxExempt: 1 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});
