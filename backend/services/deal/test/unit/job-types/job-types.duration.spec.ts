import { JobTypesService } from 'src/job-types/job-types.service';
import { JobTypesRepository } from 'src/job-types/job-types.repository';
import {
  createMockDynamoDbService,
  createMockJobType,
  createMockJobTypesRepository,
  createMockJwtUser,
  createMockSnsPublisherService,
} from '../mocks';

/**
 * Workiz's job type carries a Duration (Days / Hours / Minutes — "How long
 * does this type of job usually take?"): `JobType.durationMinutes`. Five of
 * the account's 21 active types are 2 h, 4 h or 50 h; without it every job
 * got an hour.
 */
describe('JobType.durationMinutes', () => {
  const caller = createMockJwtUser();

  describe('service', () => {
    let repo: ReturnType<typeof createMockJobTypesRepository>;
    let service: JobTypesService;

    beforeEach(() => {
      repo = createMockJobTypesRepository();
      service = new JobTypesService(repo as never, createMockSnsPublisherService() as never);
    });

    it('stores the duration a new type is created with, and none when none was given', async () => {
      const twoHours = await service.create({ name: 'Rekey', durationMinutes: 120 } as never, caller);
      expect(twoHours.durationMinutes).toBe(120);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 120 }));

      const plain = await service.create({ name: 'Lockout' } as never, caller);
      expect(plain).not.toHaveProperty('durationMinutes');
    });

    it('changes the duration on update and keeps it when the update says nothing about it', async () => {
      repo.get.mockResolvedValue(createMockJobType({ id: 'jt-1', durationMinutes: 60 }));

      const longer = await service.update('jt-1', { durationMinutes: 240 } as never, caller);
      expect(longer.durationMinutes).toBe(240);
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 240 }));

      const renamed = await service.update('jt-1', { name: 'Rekey' } as never, caller);
      expect(renamed.durationMinutes).toBe(60);
    });

    it('a duration of 0 means the type has none of its own', async () => {
      repo.get.mockResolvedValue(createMockJobType({ id: 'jt-1', durationMinutes: 60 }));

      const cleared = await service.update('jt-1', { durationMinutes: 0 } as never, caller);
      expect(cleared).not.toHaveProperty('durationMinutes');
      expect(repo.put).toHaveBeenCalledWith(expect.not.objectContaining({ durationMinutes: expect.anything() }));
    });
  });

  describe('repository', () => {
    let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
    let repository: JobTypesRepository;

    beforeEach(() => {
      dynamoDb = createMockDynamoDbService();
      repository = new JobTypesRepository(dynamoDb as never);
    });

    it('reads the duration back off the row, and leaves it off a row without one', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({ Item: { ...createMockJobType({ id: 'jt-2' }), durationMinutes: 3000 } });
      expect((await repository.get('jt-2'))?.durationMinutes).toBe(3000);

      dynamoDb.client.send.mockResolvedValueOnce({ Item: { ...createMockJobType({ id: 'jt-3' }) } });
      expect(await repository.get('jt-3')).not.toHaveProperty('durationMinutes');
    });

    it('writes it with the row', async () => {
      dynamoDb.client.send.mockResolvedValue({});
      await repository.put(createMockJobType({ id: 'jt-1', durationMinutes: 120 }));
      expect(dynamoDb.client.send.mock.calls[0][0].input.Item.durationMinutes).toBe(120);
    });
  });
});
