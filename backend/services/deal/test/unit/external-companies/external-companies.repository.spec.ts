import { ExternalCompaniesRepository } from 'src/external-companies/external-companies.repository';
import { createMockDynamoDbService, createMockExternalCompany } from '../mocks';

describe('ExternalCompaniesRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ExternalCompaniesRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ExternalCompaniesRepository(dynamoDb as any);
  });

  it('writes catalog keys on create', async () => {
    dynamoDb.client.send.mockResolvedValue({});
    await repository.create(createMockExternalCompany({ id: 'ec-1', name: 'Allied Dispatch' }));

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Item.PK).toBe('EXTERNAL_COMPANY#ec-1');
    expect(input.Item.SK).toBe('METADATA');
    expect(input.Item.GSI1PK).toBe('CATALOG#EXTERNAL_COMPANY');
    expect(input.Item.GSI1SK).toBe('allied dispatch');
    expect(input.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('strips the table keys when reading an entity back', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: {
        PK: 'EXTERNAL_COMPANY#ec-1',
        SK: 'METADATA',
        GSI1PK: 'CATALOG#EXTERNAL_COMPANY',
        GSI1SK: 'agero',
        ...createMockExternalCompany({ id: 'ec-1', name: 'Agero' }),
      },
    });

    const company = await repository.get('ec-1');

    expect(company).toMatchObject({ id: 'ec-1', name: 'Agero' });
    expect(company as unknown as Record<string, unknown>).not.toHaveProperty('PK');
    expect(company as unknown as Record<string, unknown>).not.toHaveProperty('GSI1SK');
  });

  describe('isReferencedByDeal', () => {
    it('keeps scanning past a page whose items all filtered out', async () => {
      // DynamoDB applies Limit to items EVALUATED, before the filter — a
      // filtered Scan routinely returns an empty page plus a cursor. Stopping
      // there would report "unreferenced" and let the delete destroy a company
      // that jobs still point at.
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'DEAL#x', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Items: [{ id: 'deal-9' }] });

      expect(await repository.isReferencedByDeal('ec-1')).toBe(true);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
        PK: 'DEAL#x',
        SK: 'METADATA',
      });
    });

    it('reports unreferenced only after the whole table is exhausted', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'DEAL#x', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Items: [] });

      expect(await repository.isReferencedByDeal('ec-1')).toBe(false);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    });

    it('stops at the first match without paging further', async () => {
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: [{ id: 'deal-1' }],
        LastEvaluatedKey: { PK: 'DEAL#y', SK: 'METADATA' },
      });

      expect(await repository.isReferencedByDeal('ec-1')).toBe(true);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });
});
