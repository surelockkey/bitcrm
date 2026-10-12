import { JobSuperStatus } from '@bitcrm/types';
import { DealsRepository } from 'src/deals/deals.repository';
import { createMockDynamoDbService } from '../mocks';

/**
 * «Jobs By Status» на дашборді: скільки робіт створено кожного дня і в якому
 * вони стані зараз.
 *
 * Індекс створення (GSI1) розкладений рівно так, як це питання: партиція —
 * `STATUS#<стан>`, сортувальний ключ — `<createdAt>#DEAL#<id>`. Тому серія
 * будується одним Query на стан, а не запитом на кожну клітинку: 6 запитів
 * замість 6 × довжина вікна. Розкладка по днях — з префікса ключа.
 *
 * Тіла робіт не потрібні: рахуються дні, а не рядки, тож запит тягне лише
 * сам ключ (`ProjectionExpression`). Прохід обмежений — вікно без стелі могло
 * б накрити всю історію.
 */
describe('DealsRepository.countCreatedByDay', () => {
  let repository: DealsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new DealsRepository(dynamoDb as any);
  });

  const key = (day: string, id = 'd1') => ({ GSI1SK: `${day}T10:00:00.000Z#DEAL#${id}` });

  it('buckets one status by the day its rows were created', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [key('2026-09-14', 'a'), key('2026-09-14', 'b'), key('2026-09-15', 'c')],
    });

    const out = await repository.countCreatedByDay(JobSuperStatus.DONE, {
      from: '2026-09-14',
      to: '2026-09-15',
    });

    expect(out.byDay).toEqual({ '2026-09-14': 2, '2026-09-15': 1 });
    expect(out.atLeast).toBe(false);
  });

  it('reads the status partition of the created index', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.countCreatedByDay(JobSuperStatus.CANCELED, {
      from: '2026-09-14',
      to: '2026-09-15',
    });

    const sent = dynamoDb.client.send.mock.calls[0][0];
    expect(sent.input.ExpressionAttributeValues[':pk']).toBe('STATUS#canceled');
    expect(sent.input.KeyConditionExpression).toContain('BETWEEN');
  });

  it('bounds the range to the window’s Connecticut days, as instants', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.countCreatedByDay(JobSuperStatus.DONE, {
      from: '2026-09-14',
      to: '2026-09-15',
    });

    const v = dynamoDb.client.send.mock.calls[0][0].input.ExpressionAttributeValues;
    // Sep 14 00:00 EDT .. the last millisecond of Sep 15 EDT; '~' sorts after the key's '#DEAL#…'.
    expect(v[':from']).toBe('2026-09-14T04:00:00.000Z');
    expect(v[':to']).toBe('2026-09-16T03:59:59.999Z~');
  });

  it('buckets each creation on its Connecticut day, never its UTC prefix', async () => {
    dynamoDb.client.send.mockResolvedValue({
      // 22:30 EDT on Sep 14 is 02:30 UTC on Sep 15.
      Items: [{ GSI1SK: '2026-09-15T02:30:00.000Z#DEAL#late' }, key('2026-09-15', 'b')],
    });

    const out = await repository.countCreatedByDay(JobSuperStatus.DONE, { from: '2026-09-14', to: '2026-09-15' });

    expect(out.byDay).toEqual({ '2026-09-14': 1, '2026-09-15': 1 });
  });

  // Дні рахуються, рядки — ні, тож тіла робіт по дроту не їдуть.
  it('asks for the sort key alone, not the deal bodies', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [] });

    await repository.countCreatedByDay(JobSuperStatus.DONE, {
      from: '2026-09-14',
      to: '2026-09-15',
    });

    const sent = dynamoDb.client.send.mock.calls[0][0];
    expect(sent.input.ProjectionExpression).toBeDefined();
    expect(sent.input.Select).not.toBe('ALL_ATTRIBUTES');
  });

  it('follows the cursor across pages', async () => {
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [key('2026-09-14', 'a')], LastEvaluatedKey: { PK: 'x' } })
      .mockResolvedValueOnce({ Items: [key('2026-09-14', 'b')] });

    const out = await repository.countCreatedByDay(JobSuperStatus.DONE, {
      from: '2026-09-14',
      to: '2026-09-15',
    });

    expect(out.byDay).toEqual({ '2026-09-14': 2 });
    expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 'x' });
  });

  it('gives up on an exact answer rather than walk an unbounded history', async () => {
    dynamoDb.client.send.mockResolvedValue({
      Items: [key('2026-09-14')],
      LastEvaluatedKey: { PK: 'x' },
    });

    const out = await repository.countCreatedByDay(JobSuperStatus.DONE, {
      from: '2026-09-14',
      to: '2026-09-15',
    });

    expect(out.atLeast).toBe(true);
  });

  it('a day with no rows simply does not appear', async () => {
    dynamoDb.client.send.mockResolvedValue({ Items: [key('2026-09-15')] });

    const out = await repository.countCreatedByDay(JobSuperStatus.DONE, {
      from: '2026-09-14',
      to: '2026-09-16',
    });

    expect(out.byDay).toEqual({ '2026-09-15': 1 });
  });
});
