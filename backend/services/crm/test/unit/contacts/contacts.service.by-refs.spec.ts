/**
 * `POST /crm/contacts/internal/by-ids` — names for the parties a call (or a
 * conversation) is already associated with. One BatchGet per kind, never a
 * GetItem per ref: a page of the call log can carry 200 of them.
 */
import { BadRequestException } from '@nestjs/common';
import { ContactsService, MAX_PARTY_REFS } from 'src/contacts/contacts.service';
import {
  createMockCompaniesRepository,
  createMockCompany,
  createMockContact,
  createMockContactsCacheService,
  createMockContactsRepository,
} from '../mocks';

describe('ContactsService.findManyByRef', () => {
  let repository: ReturnType<typeof createMockContactsRepository>;
  let companies: ReturnType<typeof createMockCompaniesRepository>;
  let service: ContactsService;

  beforeEach(() => {
    repository = createMockContactsRepository();
    companies = createMockCompaniesRepository();
    service = new ContactsService(
      repository as any,
      createMockContactsCacheService() as any,
      companies as any,
    );
  });

  it('resolves contacts and companies with one batch read per kind', async () => {
    repository.findByIds.mockResolvedValue([
      createMockContact({ id: 'c1', firstName: 'Jane', lastName: 'Roe' }),
      createMockContact({ id: 'c2', firstName: 'Bob', lastName: '' }),
    ]);
    companies.findByIds.mockResolvedValue([createMockCompany({ id: 'co1', title: 'Acme Locks' })]);

    const out = await service.findManyByRef([
      { kind: 'contact', id: 'c1' },
      { kind: 'company', id: 'co1' },
      { kind: 'contact', id: 'c2' },
    ]);

    expect(repository.findById).not.toHaveBeenCalled();
    expect(companies.findById).not.toHaveBeenCalled();
    expect(repository.findByIds).toHaveBeenCalledTimes(1);
    expect(repository.findByIds).toHaveBeenCalledWith(['c1', 'c2']);
    expect(companies.findByIds).toHaveBeenCalledWith(['co1']);
    expect(out).toEqual({
      'contact:c1': { kind: 'contact', id: 'c1', name: 'Jane Roe' },
      'contact:c2': { kind: 'contact', id: 'c2', name: 'Bob' },
      'company:co1': { kind: 'company', id: 'co1', name: 'Acme Locks' },
    });
  });

  it('leaves out refs that no longer exist', async () => {
    repository.findByIds.mockResolvedValue([createMockContact({ id: 'c1', firstName: 'A', lastName: 'B' })]);
    companies.findByIds.mockResolvedValue([]);

    const out = await service.findManyByRef([
      { kind: 'contact', id: 'c1' },
      { kind: 'contact', id: 'gone' },
      { kind: 'company', id: 'gone-co' },
    ]);

    expect(Object.keys(out)).toEqual(['contact:c1']);
  });

  it('asks each id once, however often it repeats', async () => {
    repository.findByIds.mockResolvedValue([]);
    await service.findManyByRef([
      { kind: 'contact', id: 'c1' },
      { kind: 'contact', id: 'c1' },
    ]);
    expect(repository.findByIds).toHaveBeenCalledWith(['c1']);
    expect(companies.findByIds).not.toHaveBeenCalled();
  });

  it('a failed read of one kind blanks that kind only, not the page', async () => {
    repository.findByIds.mockRejectedValue(new Error('throttled'));
    companies.findByIds.mockResolvedValue([createMockCompany({ id: 'co1', title: 'Acme' })]);

    const out = await service.findManyByRef([
      { kind: 'contact', id: 'c1' },
      { kind: 'company', id: 'co1' },
    ]);

    expect(out).toEqual({ 'company:co1': { kind: 'company', id: 'co1', name: 'Acme' } });
  });

  it('skips refs without a usable id instead of failing the batch', async () => {
    repository.findByIds.mockResolvedValue([]);
    await service.findManyByRef([
      { kind: 'contact', id: '' },
      { kind: 'contact', id: 42 as any },
      null as any,
      { kind: 'contact', id: 'c1' },
    ]);
    expect(repository.findByIds).toHaveBeenCalledWith(['c1']);
  });

  it('rejects a body that is not a list', async () => {
    await expect(service.findManyByRef(undefined as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it(`caps a body at ${MAX_PARTY_REFS} distinct refs (crm has no ValidationPipe)`, async () => {
    repository.findByIds.mockResolvedValue([]);
    const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'contact' as const, id: `c${i}` }));

    await expect(service.findManyByRef(refs(MAX_PARTY_REFS))).resolves.toEqual({});
    // Repeats don't count against the cap.
    await expect(service.findManyByRef([...refs(MAX_PARTY_REFS), ...refs(10)])).resolves.toEqual({});
    await expect(service.findManyByRef(refs(MAX_PARTY_REFS + 1))).rejects.toBeInstanceOf(BadRequestException);
  });
});
