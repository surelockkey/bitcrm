/**
 * The two report filters the list did not have: the client's company and
 * the job's creator. Both are plain equalities on whatever index answers.
 */
import { JobSuperStatus } from '@bitcrm/types';
import { DealsService } from '../../../src/deals/deals.service';
import { DealsRepository } from '../../../src/deals/deals.repository';
import { createMockDeal, createMockDealsRepository, createMockDynamoDbService, createMockJwtUser } from '../mocks';

function serviceWith(repo: ReturnType<typeof createMockDealsRepository>): DealsService {
  const stub = {} as any;
  return new DealsService(
    repo as any, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
  );
}

describe('companyId and createdBy filters', () => {
  it('reach the FilterExpression', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    dynamoDb.client.send.mockResolvedValue({ Items: [] });
    await repository.findBySuperStatus(JobSuperStatus.DONE, 20, undefined, { companyId: 'co-1', createdBy: 'u-1' });
    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.FilterExpression).toContain('#companyId = :companyId');
    expect(input.FilterExpression).toContain('#createdBy = :createdBy');
    expect(input.ExpressionAttributeValues[':companyId']).toBe('co-1');
    expect(input.ExpressionAttributeValues[':createdBy']).toBe('u-1');
  });

  it('are honoured in the in-memory matcher the tech index uses', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new DealsRepository(dynamoDb as any);
    const table = (repository as any).tableName as string;
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ dealId: 'a' }, { dealId: 'b' }] })
      .mockResolvedValueOnce({
        Responses: {
          [table]: [
            { ...createMockDeal({ id: 'a', companyId: 'co-1', createdBy: 'u-1' }), PK: 'DEAL#a', SK: 'METADATA' },
            { ...createMockDeal({ id: 'b', companyId: 'co-2', createdBy: 'u-1' }), PK: 'DEAL#b', SK: 'METADATA' },
          ],
        },
      });
    const page = await repository.findByTech('t1', 20, undefined, { companyId: 'co-1', createdBy: 'u-1' });
    expect(page.items.map((d) => d.id)).toEqual(['a']);
  });

  it('travel from the query to the repository', async () => {
    const repo = createMockDealsRepository();
    repo.findBySuperStatus.mockResolvedValue({ items: [], nextCursor: undefined });
    await serviceWith(repo).list({ superStatus: JobSuperStatus.DONE, companyId: 'co-1', createdBy: 'u-1' } as any, createMockJwtUser({ id: 'd' }));
    expect(repo.findBySuperStatus).toHaveBeenCalledWith(JobSuperStatus.DONE, 20, undefined, expect.objectContaining({ companyId: 'co-1', createdBy: 'u-1' }));
  });
});
