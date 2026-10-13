import { Test } from '@nestjs/testing';
import { phoneMatchVariants } from '@bitcrm/shared';
import { BadRequestException } from '@nestjs/common';
import { ContactsService, MAX_PHONE_LOOKUPS } from 'src/contacts/contacts.service';
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
  createMockDynamoDbService,
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

  /** Pointer rows: phone -> contact id, phone -> company id. */
  const pointers = (contactsByPhone: Record<string, string>, companiesByPhone: Record<string, string> = {}) => {
    repository.findIdByPhone.mockImplementation(async (p: string) => contactsByPhone[p] ?? null);
    companies.findIdByPhone.mockImplementation(async (p: string) => companiesByPhone[p] ?? null);
  };
  const rows = (contacts: any[], cos: any[] = []) => {
    repository.findByIds.mockImplementation(async (ids: string[]) => contacts.filter((c) => ids.includes(c.id)));
    companies.findByIds.mockImplementation(async (ids: string[]) => cos.filter((c) => ids.includes(c.id)));
  };

  beforeEach(() => rows([], []));

  it('resolves a number to the contact that owns it', async () => {
    pointers({ '+14045551234': 'c1' });
    rows([jane]);

    const out = await service.findManyByPhone(['+14045551234']);

    expect(out['+14045551234']).toEqual({
      kind: 'contact',
      id: 'c1',
      firstName: 'Jane',
      lastName: 'Roe',
      companyId: jane.companyId,
    });
  });

  it('reads the matched rows in one BatchGet per kind, never a GetItem per number', async () => {
    const bob = createMockContact({ id: 'c2', firstName: 'Bob', lastName: 'Lee' });
    pointers({ '+14045551234': 'c1', '+14045552222': 'c2' }, { '+14045559999': 'co1' });
    rows([jane, bob], [{ id: 'co1', title: 'Acme' }]);

    const out = await service.findManyByPhone(['+14045551234', '+14045552222', '+14045559999']);

    expect(repository.findByPhone).not.toHaveBeenCalled();
    expect(repository.findById).not.toHaveBeenCalled();
    expect(companies.findByPhone).not.toHaveBeenCalled();
    expect(repository.findByIds).toHaveBeenCalledTimes(1);
    expect(repository.findByIds.mock.calls[0][0].sort()).toEqual(['c1', 'c2']);
    expect(companies.findByIds).toHaveBeenCalledTimes(1);
    expect(companies.findByIds).toHaveBeenCalledWith(['co1']);
    expect(out['+14045552222'].id).toBe('c2');
    expect(out['+14045559999'].kind).toBe('company');
  });

  it('normalizes before lookup and keys the result both ways', async () => {
    pointers({ '+14045551234': 'c1' });
    rows([jane]);

    const out = await service.findManyByPhone(['(404) 555-1234']);

    expect(repository.findIdByPhone).toHaveBeenCalledWith('+14045551234');
    // Callers can look the result up by what they sent or by E.164.
    expect(out['(404) 555-1234']).toBeDefined();
    expect(out['+14045551234']).toBeDefined();
  });

  it('omits numbers nobody owns rather than erroring', async () => {
    pointers({});

    const out = await service.findManyByPhone(['+14045551234']);

    expect(out).toEqual({});
    // Nothing matched, nothing to batch-read.
    expect(repository.findByIds).not.toHaveBeenCalled();
    expect(companies.findByIds).not.toHaveBeenCalled();
  });

  it('skips unparseable endpoints instead of rejecting the batch', async () => {
    pointers({ '+14045551234': 'c1' });
    rows([jane]);

    const out = await service.findManyByPhone([
      'client:d47814b8-e051',
      '',
      '+14045551234',
    ]);

    // Only the real number (in each form it may be stored under) reached the repository.
    expect(repository.findIdByPhone.mock.calls.map((c: string[]) => c[0]).sort()).toEqual(
      phoneMatchVariants('+14045551234').sort(),
    );
    expect(out['+14045551234']).toBeDefined();
  });

  it('falls through to a company main line when no person owns it', async () => {
    pointers({}, { '+14045559999': 'co1' });
    rows([], [{ id: 'co1', title: 'Acme Locks' }]);

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
    pointers({ '+14045551234': 'c1' }, { '+14045551234': 'co1' });
    rows([jane], [{ id: 'co1', title: 'Acme Locks' }]);

    const out = await service.findManyByPhone(['+14045551234']);

    // Reaching Jane on the office line is still reaching Jane.
    expect(out['+14045551234'].kind).toBe('contact');
    expect(out['+14045551234'].id).toBe('c1');
  });

  it('a contact pointer whose contact row is gone falls through to the company on that number', async () => {
    pointers({ '+14045551234': 'ghost' }, { '+14045551234': 'co1' });
    rows([], [{ id: 'co1', title: 'Acme Locks' }]);

    const out = await service.findManyByPhone(['+14045551234']);

    expect(out['+14045551234']).toMatchObject({ kind: 'company', id: 'co1' });
  });

  it('finds a number stored before trunk prefixes were stripped', async () => {
    // Written as +380[0]95… under the old normalization; the call reports the
    // real E.164, which would never match on an exact lookup.
    pointers({ '+3800958601427': 'c1' });
    rows([{ ...jane, phones: ['+3800958601427'] }]);

    const out = await service.findManyByPhone(['+380958601427']);

    expect(out['+380958601427']).toBeDefined();
    expect(repository.findIdByPhone).toHaveBeenCalledWith('+3800958601427');
  });

  it('an earlier variant wins, even when it is only a company and a later one is a person', async () => {
    // Today's order: for each variant, person then company — the first variant
    // with any live owner decides. The canonical form comes first.
    pointers({ '+3800958601427': 'c1' }, { '+380958601427': 'co1' });
    rows([jane], [{ id: 'co1', title: 'Acme Locks' }]);

    const out = await service.findManyByPhone(['+380958601427']);

    expect(out['+380958601427']).toMatchObject({ kind: 'company', id: 'co1' });
  });

  it('queries each distinct number once, however often it appears', async () => {
    pointers({ '+14045551234': 'c1' });
    rows([jane]);

    await service.findManyByPhone([
      '+14045551234',
      '+14045551234',
      '(404) 555-1234',
    ]);

    // One lookup per stored form of the ONE number — not one per occurrence.
    expect(repository.findIdByPhone).toHaveBeenCalledTimes(phoneMatchVariants('+14045551234').length);
  });

  it('rejects a body that is not a list, and caps it (crm has no ValidationPipe)', async () => {
    await expect(service.findManyByPhone(undefined as any)).rejects.toBeInstanceOf(BadRequestException);
    const many = Array.from({ length: MAX_PHONE_LOOKUPS + 1 }, (_, i) => `+1404555${String(i).padStart(4, '0')}`);
    await expect(service.findManyByPhone(many)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.findManyByPhone(many.slice(0, MAX_PHONE_LOOKUPS))).resolves.toEqual({});
  });
});

describe('phone pointer reads (findIdByPhone)', () => {
  it('contacts: reads the PHONE# pointer and never the contact row', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repo = new ContactsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [{ PK: 'PHONE#+14045551234', contactId: 'c1' }] });

    expect(await repo.findIdByPhone('+14045551234')).toBe('c1');
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    expect(dynamoDb.client.send.mock.calls[0][0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'PHONE#+14045551234',
    });

    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    expect(await repo.findIdByPhone('+14045550000')).toBeNull();
  });

  it('companies: reads the PHONE#/COMPANY pointer and never the company row', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repo = new CompaniesRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Item: { companyId: 'co1' } });

    expect(await repo.findIdByPhone('+14045559999')).toBe('co1');
    expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
      PK: 'PHONE#+14045559999',
      SK: 'COMPANY',
    });

    dynamoDb.client.send.mockResolvedValue({});
    expect(await repo.findIdByPhone('+14045550000')).toBeNull();
  });
});
