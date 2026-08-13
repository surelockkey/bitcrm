import { Test } from '@nestjs/testing';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsCacheService } from 'src/contacts/contacts-cache.service';
import { SnsPublisherService } from '@bitcrm/shared';
import { CompaniesRepository } from 'src/companies/companies.repository';
import {
  createMockContact,
  createMockContactsRepository,
  createMockCompaniesRepository,
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
  let companies: ReturnType<typeof createMockCompaniesRepository>;

  beforeEach(async () => {
    repository = createMockContactsRepository();
    companies = createMockCompaniesRepository();
    const module = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: ContactsRepository, useValue: repository },
        { provide: CompaniesRepository, useValue: companies },
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
      kind: 'contact',
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

  it('falls through to a company main line when no person owns it', async () => {
    repository.findByPhone.mockResolvedValue(null);
    companies.findByPhone.mockResolvedValue({
      id: 'co1',
      title: 'Acme Locks',
    });

    const out = await service.findManyByPhone(['+14045559999']);

    expect(out['+14045559999']).toEqual({
      kind: 'company',
      id: 'co1',
      firstName: 'Acme Locks',
      lastName: '',
      companyId: 'co1',
    });
  });

  it('prefers the person over the company on a shared number', async () => {
    repository.findByPhone.mockResolvedValue(jane);
    companies.findByPhone.mockResolvedValue({ id: 'co1', title: 'Acme Locks' });

    const out = await service.findManyByPhone(['+14045551234']);

    // Reaching Jane on the office line is still reaching Jane.
    expect(out['+14045551234'].kind).toBe('contact');
    expect(companies.findByPhone).not.toHaveBeenCalled();
  });

  it('finds a number stored before trunk prefixes were stripped', async () => {
    // Written as +380[0]95… under the old normalization; the call reports the
    // real E.164, which would never match on an exact lookup.
    repository.findByPhone.mockImplementation(async (phone: string) =>
      phone === '+3800958601427' ? { ...jane, phones: [phone] } : null,
    );

    const out = await service.findManyByPhone(['+380958601427']);

    expect(out['+380958601427']).toBeDefined();
    expect(repository.findByPhone).toHaveBeenCalledWith('+3800958601427');
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
