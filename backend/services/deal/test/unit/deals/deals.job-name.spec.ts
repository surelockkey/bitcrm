/**
 * Workiz "Job name": optional free text on the job — the first field of
 * "Job Details" on the New Job page and "Job name: ✎" in the job page
 * header. The Workiz importer has always written it (`jobName`, raw
 * `job_name`); the API now takes it, stores it trimmed, reads it back and
 * clears it with `null` (or a blank string, which is what a cleared input
 * sends).
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientType, TimelineEventType } from '@bitcrm/types';
import { CreateDealDto } from 'src/deals/dto/create-deal.dto';
import { UpdateDealDto } from 'src/deals/dto/update-deal.dto';
import { DealsService } from 'src/deals/deals.service';
import { DealsRepository } from 'src/deals/deals.repository';
import {
  createMockDeal,
  createMockDealsCacheService,
  createMockDealsRepository,
  createMockDynamoDbService,
  createMockGeocodingService,
  createMockInternalHttpService,
  createMockJobType,
  createMockJwtUser,
  createMockCustomFieldsService,
  createMockTimelineRepository,
} from '../mocks';

/** The global pipe is `whitelist: true` — an undeclared property is silently dropped, so forbid it here to see it. */
const errorsOf = async (cls: new () => object, payload: object) =>
  (await validate(plainToInstance(cls, payload), { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

const createBody = {
  contactId: '6f1c2a4b-3d5e-4f60-8a71-9b2c3d4e5f60',
  clientType: ClientType.RESIDENTIAL,
  address: { street: '123 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
  jobTypeId: 'jobtype-1',
};

describe('jobName on the DTOs', () => {
  it('CreateDealDto accepts a job name', async () => {
    expect(await errorsOf(CreateDealDto, { ...createBody, jobName: 'A1 door' })).toEqual([]);
  });

  it('CreateDealDto rejects a job name that is not text', async () => {
    expect(await errorsOf(CreateDealDto, { ...createBody, jobName: 42 })).toEqual(['jobName']);
  });

  it('CreateDealDto refuses an absurdly long name', async () => {
    expect(await errorsOf(CreateDealDto, { ...createBody, jobName: 'x'.repeat(201) })).toEqual(['jobName']);
  });

  it('UpdateDealDto accepts a new name and an explicit null that clears it', async () => {
    expect(await errorsOf(UpdateDealDto, { jobName: 'Mailbox lock' })).toEqual([]);
    expect(await errorsOf(UpdateDealDto, { jobName: null })).toEqual([]);
  });
});

function makeService() {
  const repo = createMockDealsRepository();
  const cache = createMockDealsCacheService();
  const timeline = createMockTimelineRepository();
  const http = createMockInternalHttpService();
  const stub = {} as any;
  const service = new DealsService(
    repo as any,
    cache as any,
    timeline as any,
    stub,
    http as any,
    createMockGeocodingService() as any,
    { resolvePoint: jest.fn().mockResolvedValue(null), findById: jest.fn() } as any,
    { findById: jest.fn().mockResolvedValue(createMockJobType()) } as any,
    stub,
    stub,
    { list: jest.fn().mockResolvedValue([]) } as any,
    stub,
    createMockCustomFieldsService() as any,
    stub,
  );
  return { service, repo, cache, timeline };
}

describe('DealsService — jobName', () => {
  const caller = createMockJwtUser({ id: 'dispatcher-1' });

  it('create stores the name, trimmed', async () => {
    const { service, repo } = makeService();
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');

    const deal = await service.create({ ...createBody, jobName: '  A1 door  ' } as any, caller);

    expect(deal.jobName).toBe('A1 door');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ jobName: 'A1 door' }));
  });

  it('create leaves a blank name off the job', async () => {
    const { service, repo } = makeService();
    repo.reserveDealNumber.mockResolvedValue('K4T9ZW');

    const deal = await service.create({ ...createBody, jobName: '   ' } as any, caller);

    expect(deal.jobName).toBeUndefined();
    expect(repo.create.mock.calls[0][0]).not.toHaveProperty('jobName', '   ');
  });

  it('update writes the trimmed name and logs it like any other field', async () => {
    const { service, repo, cache, timeline } = makeService();
    const existing = createMockDeal({ jobName: 'Old name' });
    cache.get.mockResolvedValue(null);
    repo.findById.mockResolvedValue(existing);
    repo.update.mockResolvedValue({ ...existing, jobName: 'Rekey 3 locks' });

    await service.update('deal-1', { jobName: ' Rekey 3 locks ' } as any, caller);

    expect(repo.update).toHaveBeenCalledWith('deal-1', { jobName: 'Rekey 3 locks' });
    expect(timeline.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TimelineEventType.FIELD_UPDATED,
        details: { field: 'jobName', oldValue: 'Old name', newValue: 'Rekey 3 locks' },
      }),
    );
  });

  it('update clears the name with null — and with a blank string, which a cleared input sends', async () => {
    for (const cleared of [null, '', '   ']) {
      const { service, repo, cache } = makeService();
      const existing = createMockDeal({ jobName: 'Old name' });
      cache.get.mockResolvedValue(null);
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue({ ...existing, jobName: undefined });

      await service.update('deal-1', { jobName: cleared } as any, caller);

      // null REMOVEs the attribute in the repository; '' would be stored as an empty name.
      expect(repo.update).toHaveBeenCalledWith('deal-1', { jobName: null });
    }
  });
});

describe('toDeal — jobName', () => {
  it('reads the stored name back (the Workiz importer has always written it)', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({
      Item: { ...createMockDeal({ id: 'd1' }), PK: 'DEAL#d1', SK: 'METADATA', jobName: 'Zelli: Junk Removal' },
    });

    const deal = await repository.findById('d1');

    expect(deal?.jobName).toBe('Zelli: Junk Removal');
  });
});
