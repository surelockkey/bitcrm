import { Test } from '@nestjs/testing';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { SnsPublisherService } from '@bitcrm/shared';
import {
  createMockContact,
  createMockContactsRepository,
  createMockContactsCacheService,
  createMockSnsPublisherService,
} from '../mocks';

/**
 * Batch phone → contact resolution, used by telephony-service to name the
 * parties in the call log.
 */
describe('ContactsService.findManyByPhone', () => {
  let service: ContactsService;
  let repository: ReturnType<typeof createMockContactsRepository>;

  beforeEach(async () => {
    repository = createMockContactsRepository();
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: ContactsCacheService, useValue: createMockContactsCacheService() },
        { provide: SnsPublisherService, useValue: createMockSnsPublisherService() },
      ],
    }).compile();
    service = module.get(ContactsService);
  });

  const jane = createMockContact({
    id: 'c1',
    firstName: 'Jane',
    lastName: 'Roe',
    phones: ['+14045551234'],
  });

  it('resolves a number to the contact that owns it', async () => {
    repository.findByPhone.mockResolvedValue(jane);

    const out = await service.findManyByPhone(['+14045551234']);

    expect(out['+14045551234']).toEqual({
      id: 'c1',
      firstName: 'Jane',
      lastName: 'Roe',
      companyId: jane.companyId,
    });
  });

  it('normalizes before lookup and keys the result both ways', async () => {
    repository.findByPhone.mockResolvedValue(jane);

    const out = await service.findManyByPhone(['(404) 555-1234']);

    expect(repository.findByPhone).toHaveBeenCalledWith('+14045551234');
    // Callers can look the result up by what they sent or by E.164.
    expect(out['(404) 555-1234']).toBeDefined();
    expect(out['+14045551234']).toBeDefined();
  });

  it('omits numbers nobody owns rather than erroring', async () => {
    repository.findByPhone.mockResolvedValue(null);

    const out = await service.findManyByPhone(['+14045551234']);

    expect(out).toEqual({});
  });

  it('skips unparseable endpoints instead of rejecting the batch', async () => {
    repository.findByPhone.mockResolvedValue(jane);

    const out = await service.findManyByPhone([
      'client:d47814b8-e051',
      '',
      '+14045551234',
    ]);

    // Only the real number reached the repository.
    expect(repository.findByPhone).toHaveBeenCalledTimes(1);
    expect(out['+14045551234']).toBeDefined();
  });

  it('queries each distinct number once, however often it appears', async () => {
    repository.findByPhone.mockResolvedValue(jane);

    await service.findManyByPhone([
      '+14045551234',
      '+14045551234',
      '(404) 555-1234',
    ]);

    expect(repository.findByPhone).toHaveBeenCalledTimes(1);
  });
});
