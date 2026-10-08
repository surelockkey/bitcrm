import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { ContactAddressDto } from 'src/contacts/dto/address.dto';
import { ContactType, ContactSource } from '@bitcrm/types';
import {
  createMockContact,
  createMockContactsRepository,
  createMockContactsCacheService,
} from '../mocks';

/**
 * Workiz's "Country" select on the New Job page's Service Location, which
 * becomes the new client's first address. Stored as ISO 3166-1 alpha-2 like
 * the job's own address (absent = US). CRM runs no ValidationPipe, so the
 * service is what checks and upper-cases it.
 */
describe('Contact addresses — country', () => {
  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;
  const caller = { id: 'admin-1', cognitoSub: 's', email: 'a@t.com', roleId: 'r', department: 'HQ' };
  const toronto = { street: '1 Front St W', city: 'Toronto', state: 'ON', zip: 'M5J 2X5' };
  const dto = {
    firstName: 'Ann',
    lastName: 'Lee',
    phones: ['(404) 555-1234'],
    type: ContactType.RESIDENTIAL,
    source: ContactSource.MANUAL,
  };

  beforeEach(async () => {
    repository = createMockContactsRepository();
    repository.findByPhone.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: ContactsCacheService, useValue: createMockContactsCacheService() },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  it('the DTO documents it', async () => {
    const errors = await validate(plainToInstance(ContactAddressDto, { ...toronto, country: 'CA' }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });

  it('create stores the codes upper-cased, on the addresses and the billing address', async () => {
    const contact = await service.create(
      { ...dto, addresses: [{ ...toronto, country: ' ca ' }], billingAddress: { ...toronto, country: 'gb' } } as never,
      caller as never,
    );
    expect(contact.addresses[0].country).toBe('CA');
    expect(contact.billingAddress?.country).toBe('GB');
    expect(repository.create.mock.calls[0][0].addresses[0].country).toBe('CA');
  });

  it('a blank country is no country (US) — nothing is stored', async () => {
    const contact = await service.create({ ...dto, addresses: [{ ...toronto, country: '' }] } as never, caller as never);
    expect(contact.addresses[0]).not.toHaveProperty('country');
  });

  it('create refuses a country name', async () => {
    await expect(
      service.create({ ...dto, addresses: [{ ...toronto, country: 'Canada' }] } as never, caller as never),
    ).rejects.toThrow(BadRequestException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('update checks and upper-cases them too', async () => {
    const existing = createMockContact();
    repository.findById.mockResolvedValue(existing);
    repository.update.mockImplementation(async (_id: string, attrs: object) => ({ ...existing, ...attrs }));

    await service.update(existing.id, { addresses: [{ ...toronto, country: 'ca' }] } as never);
    expect(repository.update.mock.calls[0][1].addresses[0].country).toBe('CA');

    await expect(
      service.update(existing.id, { billingAddress: { ...toronto, country: 'CAN' } } as never),
    ).rejects.toThrow(BadRequestException);
  });
});
