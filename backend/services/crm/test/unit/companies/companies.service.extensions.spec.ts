import { Test } from '@nestjs/testing';
import { CompaniesService } from 'src/companies/companies.service';
import { CompaniesRepository } from 'src/companies/companies.repository';
import { CompaniesCacheService } from 'src/companies/companies-cache.service';
import { ClientType } from '@bitcrm/types';
import {
  createMockCompany,
  createMockCompaniesRepository,
  createMockCompaniesCacheService,
  createMockJwtUser,
} from '../mocks';

/**
 * A company main line is where extensions matter most — "dial the office,
 * then press 2 for dispatch" — which until now people had to type into the
 * number itself.
 */
describe('CompaniesService — phone extensions', () => {
  let service: CompaniesService;
  let repository: ReturnType<typeof createMockCompaniesRepository>;
  const caller = createMockJwtUser();

  beforeEach(async () => {
    repository = createMockCompaniesRepository();
    const module = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: CompaniesRepository, useValue: repository },
        { provide: CompaniesCacheService, useValue: createMockCompaniesCacheService() },
      ],
    }).compile();
    service = module.get(CompaniesService);
  });

  it('keys the extension by the normalized main line', async () => {
    const result = await service.create(
      {
        title: 'Acme Corp',
        clientType: ClientType.COMMERCIAL,
        phones: ['(404) 555-9999'],
        phoneExtensions: { '(404) 555-9999': 'press 2' },
      } as never,
      caller,
    );

    expect(result.phoneExtensions).toEqual({ '+14045559999': '2' });
  });

  it('keeps an extension on a number that never parsed', async () => {
    const result = await service.create(
      {
        title: 'Acme Corp',
        clientType: ClientType.COMMERCIAL,
        phones: ['main line'],
        phoneExtensions: { 'main line': '3' },
      } as never,
      caller,
    );

    expect(result.phoneExtensions).toEqual({ 'main line': '3' });
  });

  it('re-keys extensions against the phones being saved', async () => {
    const existing = createMockCompany({ phones: ['+14045559999'] });
    repository.findById.mockResolvedValue(existing);
    repository.update.mockResolvedValue(existing);

    await service.update('company-1', {
      phones: ['404-555-9999'],
      phoneExtensions: { '(404) 555-9999': '2' },
    } as never);

    expect(repository.update).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ phoneExtensions: { '+14045559999': '2' } }),
    );
  });

  it('prunes stored extensions when phones change without them', async () => {
    const existing = createMockCompany({
      phones: ['+14045559999', '+14045558888'],
      phoneExtensions: { '+14045559999': '2', '+14045558888': '3' },
    });
    repository.findById.mockResolvedValue(existing);
    repository.update.mockResolvedValue(existing);

    await service.update('company-1', { phones: ['+14045559999'] } as never);

    expect(repository.update).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ phoneExtensions: { '+14045559999': '2' } }),
    );
  });

  it('keeps the stored extensions when the edit does not mention them', async () => {
    const existing = createMockCompany({
      phones: ['+14045559999'],
      phoneExtensions: { '+14045559999': '2' },
    });
    repository.findById.mockResolvedValue(existing);
    repository.update.mockResolvedValue(existing);

    await service.update('company-1', { title: 'Acme LLC' } as never);

    const attrs = repository.update.mock.calls[0][1];
    expect(attrs.phoneExtensions).toBeUndefined();
  });
});
