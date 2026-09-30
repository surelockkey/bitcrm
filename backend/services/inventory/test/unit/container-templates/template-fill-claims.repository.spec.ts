import { TemplateFillClaimsRepository } from 'src/container-templates/template-fill-claims.repository';
import { INVENTORY_TABLE } from 'src/common/constants/dynamo.constants';
import { createMockDynamoDbService } from '../mocks';

const conditionFailed = () => {
  const error = new Error('The conditional request failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
};

/**
 * Подвійне натискання "Fill from warehouse": два POST рахували ту саму нестачу
 * й обидва везли. Кожен запит заявляє свій requestId умовним Put до будь-якого
 * руху; повтор знаходить заявку й отримує збережений результат.
 */
describe('TemplateFillClaimsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: TemplateFillClaimsRepository;

  const claim = { requestId: 'req-1', templateId: 'tpl-1', containerId: 'c-1', warehouseId: 'wh-1', userId: 'u-1' };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
    dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send.mockResolvedValue({});
    repository = new TemplateFillClaimsRepository(dynamoDb as any);
  });

  afterEach(() => jest.useRealTimers());

  it('claims a request id once, pending, expiring in 7 days (epoch seconds)', async () => {
    expect(await repository.claim(claim)).toBe(true);

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.TableName).toBe(INVENTORY_TABLE);
    expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(input.Item).toEqual({
      PK: 'IDEMPOTENCY#TEMPLATE_FILL#req-1',
      SK: 'METADATA',
      ...claim,
      status: 'pending',
      createdAt: '2026-09-30T12:00:00.000Z',
      expiresAt: Date.parse('2026-10-07T12:00:00.000Z') / 1000,
    });
  });

  it('answers false for a request id already claimed', async () => {
    dynamoDb.client.send.mockRejectedValue(conditionFailed());

    expect(await repository.claim(claim)).toBe(false);
  });

  it('lets any other failure through', async () => {
    dynamoDb.client.send.mockRejectedValue(new Error('throttled'));

    await expect(repository.claim(claim)).rejects.toThrow('throttled');
  });

  it('reads a claim back without its keys', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Item: { PK: 'IDEMPOTENCY#TEMPLATE_FILL#req-1', SK: 'METADATA', ...claim, status: 'done', result: { moved: [] } },
    });

    expect(await repository.find('req-1')).toEqual({ ...claim, status: 'done', result: { moved: [] } });
  });

  it('stores the result on completion, as plain data', async () => {
    await repository.complete('req-1', { moved: [], short: [], transfer: undefined });

    const input = dynamoDb.client.send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'IDEMPOTENCY#TEMPLATE_FILL#req-1', SK: 'METADATA' });
    expect(input.UpdateExpression).toBe('SET #status = :done, #result = :result');
    expect(input.ExpressionAttributeValues).toEqual({ ':done': 'done', ':result': { moved: [], short: [] } });
  });

  it('releases a pending claim so a retry after a failure can run, never a completed one', async () => {
    await repository.release('req-1');

    const sent = dynamoDb.client.send.mock.calls[0][0];
    expect(sent.constructor.name).toBe('DeleteCommand');
    expect(sent.input.ConditionExpression).toBe('#status = :pending');

    dynamoDb.client.send.mockRejectedValue(conditionFailed());
    await expect(repository.release('req-1')).resolves.toBeUndefined();
  });
});
