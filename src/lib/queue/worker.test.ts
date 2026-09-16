import { ApiError } from '../api/errors';
import { RETRY_SCHEDULE_MS } from '../api/retry';
import {
  createMemoryOutboxStore,
  createMemoryUploadStore,
} from './memory-store';
import { drainOutbox, drainUploads } from './worker';
import type { OutboxRecord, UploadRecord } from './types';

const NOW = 1_700_000_000_000;
const clock = () => NOW;
const noJitter = () => 0.5;

const action = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: 'r1',
  kind: 'arrived',
  dealId: 'd1',
  payload: '{}',
  createdAt: NOW - 1,
  attempts: 0,
  nextAttemptAt: NOW,
  lastError: null,
  state: 'pending',
  ...over,
});

const upload = (over: Partial<UploadRecord> = {}): UploadRecord => ({
  id: 'u1',
  dealId: 'd1',
  localUri: 'file:///photos/u1.jpg',
  fileName: 'u1.jpg',
  contentType: 'image/jpeg',
  size: 1024,
  category: 'after',
  attachmentId: null,
  uploadUrl: null,
  uploadHeaders: null,
  progress: 0,
  attempts: 0,
  nextAttemptAt: NOW,
  lastError: null,
  state: 'pending',
  createdAt: NOW - 1,
  ...over,
});

describe('drainOutbox', () => {
  it('sends a queued action and marks it done', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action());
    const send = jest.fn().mockResolvedValue(undefined);

    const result = await drainOutbox({ store, send, now: clock, random: noJitter });

    expect(result).toEqual({ sent: 1, failed: 0, retrying: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.peek()[0]!.state).toBe('done');
  });

  it('marks a row in flight BEFORE the request, so a crash is visible', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action());
    let stateDuringSend: string | undefined;
    const send = jest.fn().mockImplementation(async () => {
      stateDuringSend = store.peek()[0]!.state;
    });

    await drainOutbox({ store, send, now: clock, random: noJitter });
    expect(stateDuringSend).toBe('sending');
  });

  it('keeps a row ready — and does not count the attempt — when there is no signal', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action({ kind: 'note', attempts: 2 }));
    const send = jest.fn().mockRejectedValue(new ApiError(0, 'no signal'));

    const result = await drainOutbox({ store, send, now: clock, random: noJitter });

    expect(result).toEqual({ sent: 0, failed: 0, retrying: 1 });
    const [row] = store.peek();
    expect(row!.state).toBe('pending');
    expect(row!.attempts).toBe(2);
    expect(row!.nextAttemptAt).toBe(NOW);
    expect(row!.lastError).toBe('no signal');
  });

  it('backs a busy server off along the documented schedule', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action());
    const send = jest.fn().mockRejectedValue(new ApiError(503, 'unavailable'));

    await drainOutbox({ store, send, now: clock, random: noJitter });

    const [row] = store.peek();
    expect(row!.state).toBe('pending');
    expect(row!.nextAttemptAt).toBe(NOW + RETRY_SCHEDULE_MS[0]!);
  });

  it('parks a refusal where the technician can see it', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action({ kind: 'status' }));
    const send = jest
      .fn()
      .mockRejectedValue(new ApiError(400, 'Job is already closed'));

    const result = await drainOutbox({ store, send, now: clock, random: noJitter });

    expect(result).toEqual({ sent: 0, failed: 1, retrying: 0 });
    const [row] = store.peek();
    expect(row!.state).toBe('failed');
    expect(row!.lastError).toBe('Job is already closed');
  });

  it('sends one row per job at a time, so a job’s actions keep their order', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action({ id: 'first', dealId: 'd1', createdAt: NOW - 3 }));
    await store.insert(action({ id: 'second', dealId: 'd1', createdAt: NOW - 2 }));
    await store.insert(action({ id: 'other', dealId: 'd2', createdAt: NOW - 1 }));
    const send = jest.fn().mockResolvedValue(undefined);

    await drainOutbox({ store, send, now: clock, random: noJitter });

    expect(send.mock.calls.map(([r]) => (r as OutboxRecord).id).sort()).toEqual([
      'first',
      'other',
    ]);
  });

  it('tells the app about every row that settles, so the job can refresh', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action({ id: 'ok', dealId: 'd1' }));
    await store.insert(action({ id: 'bad', dealId: 'd2' }));
    const send = jest.fn().mockImplementation(async (r: OutboxRecord) => {
      if (r.id === 'bad') throw new ApiError(403, 'not on the roster');
    });
    const onSettled = jest.fn();

    await drainOutbox({ store, send, now: clock, random: noJitter, onSettled });

    const settled = Object.fromEntries(
      onSettled.mock.calls.map(([r, state]) => [(r as OutboxRecord).id, state]),
    );
    expect(settled).toEqual({ ok: 'done', bad: 'failed' });
  });

  it('sweeps rows that landed long enough ago to be old news', async () => {
    const store = createMemoryOutboxStore();
    await store.insert(action({ id: 'stale', state: 'done', nextAttemptAt: NOW - 120_000 }));
    await store.insert(action({ id: 'fresh', state: 'done', nextAttemptAt: NOW - 1_000 }));

    await drainOutbox({
      store,
      send: jest.fn(),
      now: clock,
      random: noJitter,
    });

    expect(store.peek().map((r) => r.id)).toEqual(['fresh']);
  });
});

describe('drainUploads', () => {
  const ticket = {
    id: 'att-1',
    uploadUrl: 'https://s3/put?sig=1',
    headers: { 'x-amz-server-side-encryption': 'aws:kms' },
  };

  it('presigns LAZILY — only when it is about to send the bytes', async () => {
    const store = createMemoryUploadStore();
    await store.insert(upload());
    const presign = jest.fn().mockResolvedValue(ticket);
    const put = jest.fn().mockResolvedValue(200);

    await drainUploads({ store, presign, put, now: clock, random: noJitter });

    // Presign writes the attachment's metadata and a timeline entry, so asking
    // for it any earlier would leave a ghost on the job.
    expect(presign).toHaveBeenCalledTimes(1);
    expect(store.peek()[0]!.state).toBe('done');
    expect(store.peek()[0]!.progress).toBe(1);
  });

  it('replays the SSE-KMS headers on the PUT — S3 signs them', async () => {
    const store = createMemoryUploadStore();
    await store.insert(upload());
    const put = jest.fn().mockResolvedValue(200);

    await drainUploads({
      store,
      presign: jest.fn().mockResolvedValue(ticket),
      put,
      now: clock,
      random: noJitter,
    });

    expect(put.mock.calls[0]![1]).toEqual(ticket);
  });

  it('does not presign twice for a retry that already holds a ticket', async () => {
    const store = createMemoryUploadStore();
    await store.insert(
      upload({
        attachmentId: 'att-1',
        uploadUrl: ticket.uploadUrl,
        uploadHeaders: JSON.stringify(ticket.headers),
      }),
    );
    const presign = jest.fn();

    await drainUploads({
      store,
      presign,
      put: jest.fn().mockResolvedValue(200),
      now: clock,
      random: noJitter,
    });

    expect(presign).not.toHaveBeenCalled();
  });

  it('throws away an expired link and asks for a new one', async () => {
    const store = createMemoryUploadStore();
    await store.insert(
      upload({
        attachmentId: 'att-1',
        uploadUrl: ticket.uploadUrl,
        uploadHeaders: JSON.stringify(ticket.headers),
      }),
    );

    const result = await drainUploads({
      store,
      presign: jest.fn(),
      put: jest.fn().mockResolvedValue(403),
      now: clock,
      random: noJitter,
    });

    expect(result.retrying).toBe(1);
    const [row] = store.peek();
    expect(row!.uploadUrl).toBeNull();
    expect(row!.state).toBe('pending');
    // Ready at once — a fresh signature is a round trip, not a punishment.
    expect(row!.nextAttemptAt).toBe(NOW);
  });

  it('reports progress as the bytes go, for the bar on the job screen', async () => {
    const store = createMemoryUploadStore();
    await store.insert(upload());
    const put = jest
      .fn()
      .mockImplementation(async (_r, _t, onProgress: (f: number) => void) => {
        onProgress(0.25);
        onProgress(0.75);
        return 200;
      });

    await drainUploads({
      store,
      presign: jest.fn().mockResolvedValue(ticket),
      put,
      now: clock,
      random: noJitter,
    });

    expect(store.peek()[0]!.progress).toBe(1);
  });

  it('keeps a photo queued when the phone has no signal', async () => {
    const store = createMemoryUploadStore();
    await store.insert(upload());

    const result = await drainUploads({
      store,
      presign: jest.fn().mockRejectedValue(new ApiError(0, 'no signal')),
      put: jest.fn(),
      now: clock,
      random: noJitter,
    });

    expect(result).toEqual({ sent: 0, failed: 0, retrying: 1 });
    expect(store.peek()[0]!.state).toBe('pending');
  });

  it('parks a photo the server refuses outright', async () => {
    const store = createMemoryUploadStore();
    await store.insert(upload());

    const result = await drainUploads({
      store,
      presign: jest.fn().mockRejectedValue(new ApiError(403, 'not on the roster')),
      put: jest.fn(),
      now: clock,
      random: noJitter,
    });

    expect(result.failed).toBe(1);
    expect(store.peek()[0]!.state).toBe('failed');
    expect(store.peek()[0]!.lastError).toBe('not on the roster');
  });
});
