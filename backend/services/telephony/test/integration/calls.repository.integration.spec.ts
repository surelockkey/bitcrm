import { Test } from '@nestjs/testing';
import { DynamoDbService } from '@bitcrm/shared';
import {
  CallsRepository,
  type CallRecord,
} from 'src/calls/calls.repository';
import {
  CALLS_TEST_TABLE,
  getTestDynamoDbClient,
  createTestTables,
  clearTestTable,
  destroyRawClient,
} from './setup';

describe('CallsRepository (integration)', () => {
  let repository: CallsRepository;

  const makeCall = (
    sid: string,
    startedAt: string,
    overrides?: Partial<CallRecord>,
  ): CallRecord => ({
    callSid: sid,
    direction: 'outbound',
    from: '+15412830739',
    to: '+14045551234',
    status: 'completed',
    agentId: 'agent-1',
    startedAt,
    updatedAt: startedAt,
    ...overrides,
  });

  beforeAll(async () => {
    await createTestTables();
    const module = await Test.createTestingModule({
      providers: [
        CallsRepository,
        { provide: DynamoDbService, useValue: { client: getTestDynamoDbClient() } },
      ],
    }).compile();
    repository = module.get(CallsRepository);
    (repository as any).tableName = CALLS_TEST_TABLE;
  });

  afterAll(() => {
    destroyRawClient();
  });

  beforeEach(async () => {
    await clearTestTable(CALLS_TEST_TABLE);
  });

  it('round-trips a full record through upsert + getBySid', async () => {
    const rec = makeCall('CAfull', '2026-08-05T09:00:00.000Z', {
      answeredAt: '2026-08-05T09:00:05.000Z',
      endedAt: '2026-08-05T09:02:05.000Z',
      durationSeconds: 120,
      conferenceName: 'conf-CAfull',
      conferenceSid: 'CF123',
      recordingSid: 'RE123',
      recordingDurationSeconds: 118,
    });
    await repository.upsert(rec);

    const got = await repository.getBySid('CAfull');
    expect(got).toMatchObject({
      callSid: 'CAfull',
      answeredAt: '2026-08-05T09:00:05.000Z',
      endedAt: '2026-08-05T09:02:05.000Z',
      conferenceName: 'conf-CAfull',
      conferenceSid: 'CF123',
      recordingSid: 'RE123',
      recordingDurationSeconds: 118,
      durationSeconds: 120,
    });
  });

  it('lists globally, newest first', async () => {
    await repository.upsert(makeCall('CA1', '2026-08-05T08:00:00.000Z'));
    await repository.upsert(makeCall('CA2', '2026-08-05T09:00:00.000Z'));
    await repository.upsert(makeCall('CA3', '2026-08-05T10:00:00.000Z'));

    const res = await repository.list({}, undefined, 10);
    expect(res.items.map((c) => c.callSid)).toEqual(['CA3', 'CA2', 'CA1']);
    expect(res.nextCursor).toBeUndefined();
  });

  it('walks pages via cursors without skipping or repeating', async () => {
    for (let i = 1; i <= 7; i++) {
      await repository.upsert(
        makeCall(`CApage${i}`, `2026-08-05T0${i}:00:00.000Z`),
      );
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let hops = 0; hops < 5; hops++) {
      const page = await repository.list({}, cursor, 3);
      seen.push(...page.items.map((c) => c.callSid));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toEqual([
      'CApage7', 'CApage6', 'CApage5',
      'CApage4', 'CApage3', 'CApage2',
      'CApage1',
    ]);
  });

  it('filters by status, direction and number substring', async () => {
    await repository.upsert(
      makeCall('CAin', '2026-08-05T08:00:00.000Z', {
        direction: 'inbound',
        from: '+380958601427',
        status: 'no-answer',
      }),
    );
    await repository.upsert(makeCall('CAout', '2026-08-05T09:00:00.000Z'));

    const byStatus = await repository.list({ status: 'no-answer' }, undefined, 10);
    expect(byStatus.items.map((c) => c.callSid)).toEqual(['CAin']);

    const byDirection = await repository.list({ direction: 'outbound' }, undefined, 10);
    expect(byDirection.items.map((c) => c.callSid)).toEqual(['CAout']);

    const byNumber = await repository.list({ number: '38095' }, undefined, 10);
    expect(byNumber.items.map((c) => c.callSid)).toEqual(['CAin']);
  });

  it('filters by date range on the sort key', async () => {
    await repository.upsert(makeCall('CAold', '2026-08-01T10:00:00.000Z'));
    await repository.upsert(makeCall('CAmid', '2026-08-03T10:00:00.000Z'));
    await repository.upsert(makeCall('CAnew', '2026-08-05T10:00:00.000Z'));

    const res = await repository.list(
      { dateFrom: '2026-08-02', dateTo: '2026-08-04' },
      undefined,
      10,
    );
    expect(res.items.map((c) => c.callSid)).toEqual(['CAmid']);
  });

  it('listLive returns only recent non-terminal calls', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const stale = new Date(now.getTime() - 48 * 3600_000).toISOString();

    await repository.upsert(
      makeCall('CAlive', recent, { status: 'in-progress' }),
    );
    await repository.upsert(makeCall('CAdone', recent, { status: 'completed' }));
    await repository.upsert(
      makeCall('CAstale', stale, { status: 'in-progress' }),
    );

    const live = await repository.listLive();
    expect(live.map((c) => c.callSid)).toEqual(['CAlive']);
  });

  it('appendChildSid is idempotent per sid', async () => {
    await repository.upsert(makeCall('CAparent', '2026-08-05T08:00:00.000Z'));
    await repository.appendChildSid('CAparent', 'CAchild1');
    await repository.appendChildSid('CAparent', 'CAchild1'); // duplicate
    await repository.appendChildSid('CAparent', 'CAchild2');

    const got = await repository.getBySid('CAparent');
    expect(got?.childSids).toEqual(['CAchild1', 'CAchild2']);
  });

  it('keeps the GSI2 sort key stable across re-upserts (status updates)', async () => {
    const rec = makeCall('CAstable', '2026-08-05T08:00:00.000Z', {
      status: 'ringing',
    });
    await repository.upsert(rec);
    // Later status callback with a different timestamp must not move the call
    // in the time-ordered index.
    await repository.upsert({
      ...rec,
      status: 'completed',
      startedAt: '2026-08-05T08:00:07.000Z',
      updatedAt: '2026-08-05T08:02:00.000Z',
    });

    const got = await repository.getBySid('CAstable');
    expect(got?.startedAt).toBe('2026-08-05T08:00:00.000Z'); // if_not_exists
    expect(got?.status).toBe('completed');
    const res = await repository.list({}, undefined, 10);
    expect(res.items.map((c) => c.callSid)).toEqual(['CAstable']);
  });
});
