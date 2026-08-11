import { CallsService } from '../../src/calls/calls.service';
import {
  CallsRepository,
  type CallRecord,
} from '../../src/calls/calls.repository';

/**
 * listLive must never surface zombie records: a webhook can be lost (deploys,
 * crashed dev runs), leaving a call stuck in a live status forever. Anything
 * still "ringing" long past the 25s ring timeout — or "in-progress" for an
 * implausibly long time — is reported as canceled and healed in the store.
 */
describe('CallsService.listLive — stale self-heal', () => {
  const NOW = new Date('2026-08-05T12:00:00.000Z').getTime();

  function make(records: CallRecord[]) {
    const upserts: CallRecord[] = [];
    const repo = {
      listLive: jest.fn().mockResolvedValue(records),
      getBySid: jest
        .fn()
        .mockImplementation(
          async (sid: string) => records.find((r) => r.callSid === sid) ?? null,
        ),
      upsert: jest.fn().mockImplementation(async (r: CallRecord) => {
        upserts.push(r);
      }),
    } as unknown as CallsRepository;
    return { service: new CallsService(repo), upserts };
  }

  const rec = (
    sid: string,
    status: CallRecord['status'],
    ageMinutes: number,
  ): CallRecord => ({
    callSid: sid,
    status,
    startedAt: new Date(NOW - ageMinutes * 60_000).toISOString(),
    updatedAt: new Date(NOW - ageMinutes * 60_000).toISOString(),
  });

  it('keeps genuinely live calls', async () => {
    const { service } = make([
      rec('CAring', 'ringing', 1),
      rec('CAtalk', 'in-progress', 30),
    ]);
    const live = await service.listLive(NOW);
    expect(live.map((c) => c.callSid)).toEqual(['CAring', 'CAtalk']);
  });

  it('drops and heals a ring stuck past any plausible timeout', async () => {
    const { service, upserts } = make([
      rec('CAzombie', 'ringing', 60),
      rec('CAfresh', 'ringing', 1),
    ]);
    const live = await service.listLive(NOW);

    expect(live.map((c) => c.callSid)).toEqual(['CAfresh']);
    // healed to a terminal status so it stops resurfacing
    expect(upserts.some((u) => u.callSid === 'CAzombie' && u.status === 'canceled')).toBe(true);
  });

  it('drops an in-progress record older than the max plausible call length', async () => {
    const { service, upserts } = make([rec('CAforever', 'in-progress', 9 * 60)]);
    const live = await service.listLive(NOW);
    expect(live).toEqual([]);
    expect(upserts.some((u) => u.callSid === 'CAforever' && u.status === 'canceled')).toBe(true);
  });
});
