import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CallTag } from '@bitcrm/types';
import { CallsService } from '../../src/calls/calls.service';
import {
  CallTagsConflictError,
  type CallRecord,
} from '../../src/calls/calls.repository';

/**
 * Tagging a call — the Workiz "Tags" column on the call log. The service
 * validates against the catalog, computes the next list from a delta, and
 * writes it as a compare-and-set that is retried on a race.
 */
const tag = (over: Partial<CallTag>): CallTag => ({
  id: 't-spam',
  name: 'SPAM CALLER',
  color: 'red',
  priority: 0,
  active: true,
  createdBy: 'u1',
  createdAt: '',
  updatedAt: '',
  ...over,
});

const CATALOG = new Map<string, CallTag>([
  ['t-spam', tag({ id: 't-spam', name: 'SPAM CALLER' })],
  ['t-tech', tag({ id: 't-tech', name: 'Tech Call', color: 'amber' })],
  ['t-wrong', tag({ id: 't-wrong', name: 'WRONG NUMBER', color: 'green' })],
  ['t-old', tag({ id: 't-old', name: 'called in CTM', active: false })],
]);

function build(stored: Partial<CallRecord> | null, over: Record<string, unknown> = {}) {
  let record: CallRecord | null = stored
    ? ({
        callSid: 'CA1',
        startedAt: '2026-09-16T10:00:00.000Z',
        updatedAt: '2026-09-16T10:00:00.000Z',
        status: 'completed',
        ...stored,
      } as CallRecord)
    : null;

  const repo = {
    getBySid: jest.fn(async () => (record ? { ...record } : null)),
    setTags: jest.fn(async (_sid: string, next: string[]) => {
      if (record) {
        record = {
          ...record,
          tagIds: next.length ? next : undefined,
          updatedAt: '2026-09-16T10:05:00.000Z',
        };
      }
    }),
    ...(over.repo as object),
  };
  const bus = { publish: jest.fn() };
  const sns = { publish: jest.fn().mockResolvedValue(undefined) };
  const callTags = {
    byId: jest.fn(async () => CATALOG),
    ...(over.callTags as object),
  };

  const service = new CallsService(
    repo as never,
    bus as never,
    undefined,
    sns as never,
    undefined,
    undefined,
    over.callTags === null ? undefined : (callTags as never),
  );
  return { service, repo, bus, sns, callTags, current: () => record };
}

const actor = { id: 'u-dana' };

describe('CallsService.updateTags', () => {
  it('adds tags to an untagged call and announces the change', async () => {
    const { service, repo, bus, sns } = build({});

    const out = await service.updateTags('CA1', { add: ['t-spam'] }, actor);

    // Compare-and-set against what was read: nothing stored yet.
    expect(repo.setTags).toHaveBeenCalledWith('CA1', ['t-spam'], undefined);
    expect(out?.tagIds).toEqual(['t-spam']);
    // The live UI (SSE) and the event bus both hear about it.
    expect(bus.publish).toHaveBeenCalledWith({
      type: 'call.upserted',
      call: expect.objectContaining({ callSid: 'CA1', tagIds: ['t-spam'] }),
    });
    expect(sns.publish).toHaveBeenCalledWith(
      'call-events',
      'call.updated',
      expect.objectContaining({ callSid: 'CA1', tagIds: ['t-spam'], actorId: 'u-dana' }),
    );
  });

  it('removes a tag, keeping the others in their order', async () => {
    const { service, repo } = build({ tagIds: ['t-spam', 't-tech'] });

    const out = await service.updateTags('CA1', { remove: ['t-spam'] }, actor);

    expect(repo.setTags).toHaveBeenCalledWith('CA1', ['t-tech'], ['t-spam', 't-tech']);
    expect(out?.tagIds).toEqual(['t-tech']);
  });

  it('taking the last tag off leaves no list behind', async () => {
    const { service, repo } = build({ tagIds: ['t-spam'] });

    const out = await service.updateTags('CA1', { remove: ['t-spam'] }, actor);

    expect(repo.setTags).toHaveBeenCalledWith('CA1', [], ['t-spam']);
    expect(out?.tagIds).toBeUndefined();
  });

  it('adds and removes in one call, deduplicating what it is given', async () => {
    const { service, repo } = build({ tagIds: ['t-spam'] });

    await service.updateTags(
      'CA1',
      { add: ['t-tech', 't-tech', 't-spam'], remove: ['t-spam', ''] },
      actor,
    );

    expect(repo.setTags).toHaveBeenCalledWith('CA1', ['t-tech'], ['t-spam']);
  });

  it('writes nothing when the call is already in the requested state', async () => {
    const { service, repo, bus, sns } = build({ tagIds: ['t-spam'] });

    const out = await service.updateTags('CA1', { add: ['t-spam'] }, actor);

    expect(repo.setTags).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
    expect(sns.publish).not.toHaveBeenCalled();
    expect(out?.tagIds).toEqual(['t-spam']);
  });

  it('lets a tag that has since been archived come off, but not go on', async () => {
    const { service, repo } = build({ tagIds: ['t-old'] });

    await service.updateTags('CA1', { remove: ['t-old'] }, actor);
    expect(repo.setTags).toHaveBeenCalledWith('CA1', [], ['t-old']);

    await expect(
      service.updateTags('CA1', { add: ['t-old'] }, actor),
    ).rejects.toThrow(/"called in CTM" is archived/);
  });

  it('404s for a tag the catalog does not know', async () => {
    const { service, repo } = build({});
    await expect(
      service.updateTags('CA1', { add: ['t-nope'] }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.setTags).not.toHaveBeenCalled();
  });

  it('400s an empty change rather than writing nothing quietly', async () => {
    const { service } = build({});
    await expect(service.updateTags('CA1', {}, actor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.updateTags('CA1', { add: [], remove: [] }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps how many tags one call can carry', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `t-${i}`);
    const { service } = build(
      { tagIds: many },
      { callTags: null }, // no catalog check, so the cap is what fails
    );
    await expect(
      service.updateTags('CA1', { add: ['t-one-more'] }, actor),
    ).rejects.toThrow(/at most 25 tags/);
  });

  it('returns null for a call that does not exist', async () => {
    const { service, repo } = build(null);
    expect(await service.updateTags('CAnope', { add: ['t-spam'] }, actor)).toBeNull();
    expect(repo.setTags).not.toHaveBeenCalled();
  });

  it('re-reads and retries when somebody else tagged the call first', async () => {
    // Read → ['t-spam']; another dispatcher adds t-tech in between; the
    // conditional write fails; the retry sees both and adds ours on top.
    let stored: string[] | undefined = ['t-spam'];
    const repo = {
      getBySid: jest.fn(async () => ({
        callSid: 'CA1',
        startedAt: '',
        updatedAt: '',
        tagIds: stored,
      })),
      setTags: jest
        .fn()
        .mockImplementationOnce(async () => {
          stored = ['t-spam', 't-tech'];
          throw new CallTagsConflictError('CA1');
        })
        .mockImplementationOnce(async (_sid: string, next: string[]) => {
          stored = next;
        }),
    };
    const { service } = build({}, { repo });

    const out = await service.updateTags('CA1', { add: ['t-wrong'] }, actor);

    expect(repo.setTags).toHaveBeenCalledTimes(2);
    expect(repo.setTags).toHaveBeenLastCalledWith(
      'CA1',
      ['t-spam', 't-tech', 't-wrong'],
      ['t-spam', 't-tech'],
    );
    expect(out?.tagIds).toEqual(['t-spam', 't-tech', 't-wrong']);
  });

  it('gives up after repeated conflicts instead of spinning', async () => {
    const repo = {
      getBySid: jest.fn(async () => ({ callSid: 'CA1', startedAt: '', updatedAt: '' })),
      setTags: jest.fn(async () => {
        throw new CallTagsConflictError('CA1');
      }),
    };
    const { service } = build({}, { repo });

    await expect(
      service.updateTags('CA1', { add: ['t-spam'] }, actor),
    ).rejects.toBeInstanceOf(CallTagsConflictError);
    expect(repo.setTags).toHaveBeenCalledTimes(3);
  });

  it('skips catalog validation when constructed without the catalog (unit wiring)', async () => {
    const { service, repo } = build({}, { callTags: null });
    await service.updateTags('CA1', { add: ['anything'] }, actor);
    expect(repo.setTags).toHaveBeenCalledWith('CA1', ['anything'], undefined);
  });

  it('never announces the hidden receiving leg of an internal call on the live bus', async () => {
    const { service, bus, sns } = build({ internalLegOf: 'CA0' });
    await service.updateTags('CA1', { add: ['t-spam'] }, actor);
    expect(bus.publish).not.toHaveBeenCalled();
    // The cross-service event still fires — the record did change.
    expect(sns.publish).toHaveBeenCalled();
  });
});
