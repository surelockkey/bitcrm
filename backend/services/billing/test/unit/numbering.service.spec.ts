import { BadRequestException, ConflictException } from '@nestjs/common';
import { NumberingRepository } from 'src/numbering/numbering.repository';
import { NumberingService } from 'src/numbering/numbering.service';
import { NOW } from './mocks';

/**
 * A DynamoDB that understands exactly the two UpdateItems the repository
 * sends — evaluated against ONE row, each command applied whole and in
 * arrival order, as DynamoDB applies them — plus a read that answers a
 * snapshot. Every command first yields to the event loop, so concurrent
 * callers interleave their reads and writes the way real requests do.
 */
function dynamoFake(initial: Record<string, unknown> = {}) {
  let row: Record<string, unknown> | undefined = Object.keys(initial).length ? { ...initial } : undefined;
  const commands: string[] = [];
  const tick = () => new Promise<void>((r) => setTimeout(r, 1));

  const send = async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    await tick();
    const { input } = cmd;
    commands.push(cmd.constructor.name);
    if (cmd.constructor.name === 'GetCommand') return { Item: row ? { ...row } : undefined };
    if (cmd.constructor.name !== 'UpdateCommand') throw new Error(`unexpected ${cmd.constructor.name}`);
    const names = input.ExpressionAttributeNames as Record<string, string>;
    const values = input.ExpressionAttributeValues as Record<string, unknown>;
    const attr = names['#n'];
    const expr = input.UpdateExpression as string;
    const current = row ?? {};
    if (expr === 'SET #n = if_not_exists(#n, :seed) + :one') {
      const base = typeof current[attr] === 'number' ? (current[attr] as number) : (values[':seed'] as number);
      const next = base + (values[':one'] as number);
      row = { ...current, [attr]: next };
      return { Attributes: { [attr]: next } };
    }
    if (expr === 'SET #n = :last, numberingUpdatedBy = :by, numberingUpdatedAt = :at') {
      if (input.ConditionExpression !== 'attribute_not_exists(#n) OR #n <= :last') {
        throw new Error(`unexpected condition ${String(input.ConditionExpression)}`);
      }
      const last = values[':last'] as number;
      const ok = current[attr] === undefined || (current[attr] as number) <= last;
      if (!ok) throw Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
      row = { ...current, [attr]: last, numberingUpdatedBy: values[':by'], numberingUpdatedAt: values[':at'] };
      return {};
    }
    throw new Error(`unexpected update ${expr}`);
  };
  return { client: { send: jest.fn(send) }, commands, row: () => row };
}

const service = (db: ReturnType<typeof dynamoFake>) => new NumberingService(new NumberingRepository(db as never));

describe('NumberingService', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] }).setSystemTime(new Date(NOW)));
  afterEach(() => jest.useRealTimers());

  describe('the next numbers', () => {
    it('start where the legacy shared counter left off: 1001 on a fresh account', async () => {
      const s = await service(dynamoFake()).get();
      expect(s).toEqual({ nextInvoiceNumber: 1001, nextEstimateNumber: 1001 });
    });

    it('follow the legacy numbers (1000 + documentSeq) until a counter of its own exists', async () => {
      const s = await service(dynamoFake({ documentSeq: 7 })).get();
      expect(s).toEqual({ nextInvoiceNumber: 1008, nextEstimateNumber: 1008 });
    });

    it('are each its own counter once set, with who set them', async () => {
      const db = dynamoFake({
        documentSeq: 7,
        lastInvoiceNumber: 85426,
        lastEstimateNumber: 1141,
        numberingUpdatedBy: 'u-9',
        numberingUpdatedAt: NOW,
      });
      expect(await service(db).get()).toEqual({
        nextInvoiceNumber: 85427,
        nextEstimateNumber: 1142,
        updatedBy: 'u-9',
        updatedAt: NOW,
      });
    });
  });

  describe('handing numbers out', () => {
    it('gives a client invoice the next number and moves the counter, as a string', async () => {
      const db = dynamoFake({ lastInvoiceNumber: 85426 });
      const svc = service(db);
      expect(await svc.nextNumber('invoice')).toBe('85427');
      expect(await svc.nextNumber('invoice')).toBe('85428');
      expect((await svc.get()).nextInvoiceNumber).toBe(85429);
    });

    it('seeds a counter that was never set from the legacy numbers, so nothing is handed out twice', async () => {
      const db = dynamoFake({ documentSeq: 3 }); // legacy stub documents 1001, 1002, 1003 exist
      const svc = service(db);
      expect(await svc.nextNumber('estimate')).toBe('1004');
      expect(await svc.nextNumber('invoice')).toBe('1004'); // its own sequence, as Workiz keeps two
      expect(await svc.nextNumber('estimate')).toBe('1005');
    });

    it('RACE: forty concurrent requests on a fresh counter get forty distinct consecutive numbers', async () => {
      const db = dynamoFake({ documentSeq: 10 });
      const svc = service(db);
      const numbers = await Promise.all(Array.from({ length: 40 }, () => svc.nextNumber('invoice')));
      const sorted = numbers.map(Number).sort((a, b) => a - b);
      expect(new Set(sorted).size).toBe(40);
      expect(sorted[0]).toBe(1011);
      expect(sorted[39]).toBe(1050);
      expect((await svc.get()).nextInvoiceNumber).toBe(1051);
    });
  });

  describe('setting the next numbers (Settings → Numbering)', () => {
    it('sets each counter so the NEXT document gets the number typed', async () => {
      const db = dynamoFake({ documentSeq: 3 });
      const svc = service(db);
      const saved = await svc.update({ nextInvoiceNumber: 85427, nextEstimateNumber: 1142 }, 'u-9');
      expect(saved).toEqual({ nextInvoiceNumber: 85427, nextEstimateNumber: 1142, updatedBy: 'u-9', updatedAt: NOW });
      expect(await svc.nextNumber('invoice')).toBe('85427');
      expect(await svc.nextNumber('estimate')).toBe('1142');
    });

    it('changes only the counter that was sent', async () => {
      const db = dynamoFake({ lastInvoiceNumber: 85426, lastEstimateNumber: 1141 });
      const saved = await service(db).update({ nextEstimateNumber: 2000 }, 'u-9');
      expect(saved.nextInvoiceNumber).toBe(85427);
      expect(saved.nextEstimateNumber).toBe(2000);
    });

    it('must be more than the last number handed out — and says which that was', async () => {
      const db = dynamoFake({ lastInvoiceNumber: 85426, lastEstimateNumber: 1141 });
      const svc = service(db);
      await expect(svc.update({ nextInvoiceNumber: 85426 }, 'u')).rejects.toThrow(
        new BadRequestException('Next Invoice Id must be more than the last number (85426)'),
      );
      await expect(svc.update({ nextEstimateNumber: 5 }, 'u')).rejects.toThrow(
        new BadRequestException('Next Estimate Id must be more than the last number (1141)'),
      );
      // The legacy numbers count as handed out too.
      await expect(service(dynamoFake({ documentSeq: 140 })).update({ nextEstimateNumber: 1140 }, 'u')).rejects.toThrow(
        new BadRequestException('Next Estimate Id must be more than the last number (1140)'),
      );
      expect(db.row()).toMatchObject({ lastInvoiceNumber: 85426, lastEstimateNumber: 1141 });
    });

    it('typing the number that is already next is fine (nothing moves)', async () => {
      const db = dynamoFake({ lastInvoiceNumber: 85426 });
      const saved = await service(db).update({ nextInvoiceNumber: 85427 }, 'u-9');
      expect(saved.nextInvoiceNumber).toBe(85427);
    });

    it('refuses what is not a whole number from 1 up to nine digits, and an empty update', async () => {
      const svc = service(dynamoFake());
      for (const bad of [0, -1, 1.5, Number.NaN, 1_000_000_000, '85427' as unknown as number]) {
        await expect(svc.update({ nextInvoiceNumber: bad }, 'u')).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(svc.update({}, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('RACE: a number handed out while the office typed wins — the save is refused, nothing is reused', async () => {
      const db = dynamoFake({ lastInvoiceNumber: 85426 });
      const svc = service(db);
      // The office reads 85426 as the last number; before its save lands two
      // client invoices are created: the conditional update refuses the save.
      const repo = new NumberingRepository(db as never);
      const originalRead = repo.read.bind(repo);
      let reads = 0;
      repo.read = async () => {
        const row = await originalRead();
        if (reads++ === 0) {
          await repo.allocate('invoice', 85426); // 85427 goes out meanwhile
          await repo.allocate('invoice', 85426); // and 85428
        }
        return row;
      };
      await expect(new NumberingService(repo).update({ nextInvoiceNumber: 85428 }, 'u')).rejects.toThrow(
        new ConflictException('Next Invoice Id must be more than the last number (85428) — a document took a number just now'),
      );
      expect(db.row()).toMatchObject({ lastInvoiceNumber: 85428 });
      expect(await svc.nextNumber('invoice')).toBe('85429');
    });
  });
});
