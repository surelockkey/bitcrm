import { DynamoDbService } from '@bitcrm/shared';
import { CallsRepository, type ListCallsFilter } from '../../src/calls/calls.repository';

/**
 * Скільки дзвінків підпадає під фільтр — число, з якого панель робить
 * «Page 2 of 7».
 *
 * Лог дзвінків — найбільший список у застосунку, і він розкладений по
 * місячних партиціях GSI2. Лічильник іде тими самими місяцями, що й список,
 * але з `Select: 'COUNT'`: тіла рядків не повертаються, лише число на місяць.
 *
 * Прохід обмежений. Без вікна дат він сягає {@link CALLS_MIN_MONTH}, і
 * відкриття сторінки не має права коштувати обходу всієї історії — тому,
 * упершись у бюджет, відповідь стає «не менше», а панель пише `7+`.
 */
function makeRepo(pages: Array<{ Count: number; LastEvaluatedKey?: unknown }>) {
  const sent: Array<{ input: Record<string, any> }> = [];
  let i = 0;
  const client = {
    send: jest.fn(async (cmd: { input: Record<string, any> }) => {
      sent.push(cmd);
      const res = pages[Math.min(i, pages.length - 1)] ?? { Count: 0 };
      i += 1;
      return res;
    }),
  };
  const repo = new CallsRepository({ client } as unknown as DynamoDbService);
  return { repo, sent };
}

// One month, so the walk is a single partition and the arithmetic is readable.
const oneMonth: ListCallsFilter = {
  dateFrom: '2026-08-01T00:00:00.000Z',
  dateTo: '2026-08-31T23:59:59.999Z',
};

describe('CallsRepository.count', () => {
  it('counts without pulling call bodies back', async () => {
    const { repo, sent } = makeRepo([{ Count: 137 }]);

    await expect(repo.count(oneMonth)).resolves.toEqual({ total: 137, atLeast: false });
    expect(sent[0].input.Select).toBe('COUNT');
  });

  it('counts in the month partitions the list walks', async () => {
    const { repo, sent } = makeRepo([{ Count: 1 }]);

    await repo.count(oneMonth);

    expect(sent[0].input.ExpressionAttributeValues[':allPk']).toBe('CALL#2026-08');
  });

  it('adds the months of a window up', async () => {
    const { repo } = makeRepo([{ Count: 10 }]);
    const threeMonths: ListCallsFilter = {
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-08-31T23:59:59.999Z',
    };

    // Three months, ten each.
    await expect(repo.count(threeMonths)).resolves.toEqual({ total: 30, atLeast: false });
  });

  it('follows the cursor within a month', async () => {
    const { repo, sent } = makeRepo([
      { Count: 100, LastEvaluatedKey: { PK: 'CALL#a' } },
      { Count: 37 },
    ]);

    await expect(repo.count(oneMonth)).resolves.toEqual({ total: 137, atLeast: false });
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'CALL#a' });
  });

  it('carries the list’s filters, so the number matches the rows', async () => {
    const { repo, sent } = makeRepo([{ Count: 3 }]);

    await repo.count({ ...oneMonth, status: 'completed', direction: 'inbound' });

    expect(sent[0].input.FilterExpression).toContain('#status = :status');
    expect(sent[0].input.ExpressionAttributeValues[':status']).toBe('completed');
    expect(sent[0].input.ExpressionAttributeValues[':direction']).toBe('inbound');
  });

  // The receiving leg of an internal call is bookkeeping — the list hides it,
  // so the count must not count it.
  it('excludes the internal leg the list excludes', async () => {
    const { repo, sent } = makeRepo([{ Count: 3 }]);

    await repo.count(oneMonth);

    expect(sent[0].input.FilterExpression).toContain('attribute_not_exists(internalLegOf)');
  });

  it('stops on its budget and says the tally is a floor', async () => {
    // Every read says "there is more", so the walk can never finish.
    const { repo, sent } = makeRepo([{ Count: 5, LastEvaluatedKey: { PK: 'CALL#x' } }]);

    const result = await repo.count(oneMonth);

    expect(result.atLeast).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    // Bounded: a page load never walks the whole log.
    expect(sent.length).toBeLessThanOrEqual(60);
  });
});
