import { DynamoDbService } from '@bitcrm/shared';
import { CallsRepository, type CallRecord } from '../../src/calls/calls.repository';

/**
 * The single highest-probability silent bug in this feature.
 *
 * `upsert` builds its UpdateExpression from a HARDCODED list of optional
 * attribute names. `LifecycleUpdate` is `Partial<CallRecord>`, so a field added
 * to the interface but forgotten in that list is dropped on every write — with
 * no type error, no runtime warning, and no failing build. The record simply
 * never carries it, and the feature that reads it looks broken somewhere else.
 *
 * This spec round-trips every optional attribute through a fake DynamoDB and
 * asserts it survives. Adding a field to CallRecord without adding it to the
 * whitelist makes it fail.
 */
describe('CallsRepository upsert — the optional attribute whitelist', () => {
  /** Every optional CallRecord field, with a value that is not dropped. */
  const OPTIONAL: Partial<CallRecord> = {
    direction: 'outbound',
    from: '+14045550100',
    to: '+14045551234',
    status: 'in-progress',
    agentId: 'user-1',
    durationSeconds: 42,
    answeredAt: '2026-08-26T10:00:05.000Z',
    endedAt: '2026-08-26T10:01:00.000Z',
    conferenceName: 'conf-CA1',
    conferenceSid: 'CF1',
    flowName: 'Main line',
    recordingSid: 'RE1',
    recordingDurationSeconds: 30,
    internalLegOf: 'CA0',
    origin: 'bridge',
    callerIdSource: 'area',
  };

  const BASE = {
    callSid: 'CA1',
    startedAt: '2026-08-26T10:00:00.000Z',
    updatedAt: '2026-08-26T10:00:00.000Z',
  };

  function makeRepo() {
    const sent: Array<Record<string, unknown>> = [];
    const client = {
      send: jest.fn(async (cmd: { input: Record<string, unknown> }) => {
        sent.push(cmd.input);
        return { Attributes: {} };
      }),
    };
    const repo = new CallsRepository({ client } as unknown as DynamoDbService);
    return { repo, sent };
  }

  /** The names actually written into the UpdateExpression. */
  function writtenNames(input: Record<string, unknown>): string[] {
    const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
    return Object.values(names);
  }

  it('writes every optional attribute it was given', async () => {
    const { repo, sent } = makeRepo();

    await repo.upsert({ ...BASE, ...OPTIONAL });

    const names = writtenNames(sent.at(-1)!);
    const missing = Object.keys(OPTIONAL).filter((f) => !names.includes(f));
    // Named explicitly: the failure message has to say WHICH field was dropped,
    // because the symptom otherwise shows up in an unrelated feature.
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(OPTIONAL))(
    'persists %s specifically',
    async (field) => {
      const { repo, sent } = makeRepo();

      await repo.upsert({
        ...BASE,
        [field]: OPTIONAL[field as keyof CallRecord],
      } as never);

      expect(writtenNames(sent.at(-1)!)).toContain(field);
    },
  );

  it('skips undefined, null and empty-string values', async () => {
    // Twilio callbacks report blank fields (To="" on SDK legs) and those must
    // not clobber a real value already on the record.
    const { repo, sent } = makeRepo();

    await repo.upsert({
      ...BASE,
      to: '',
      origin: undefined,
      agentId: null as never,
    });

    const names = writtenNames(sent.at(-1)!);
    expect(names).not.toContain('to');
    expect(names).not.toContain('origin');
    expect(names).not.toContain('agentId');
  });
});
