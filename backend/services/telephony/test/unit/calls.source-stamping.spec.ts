import { CallsService } from '../../src/calls/calls.service';
import {
  CallsRepository,
  type CallRecord,
} from '../../src/calls/calls.repository';
import { NumberSettingsRepository } from '../../src/numbers/number-settings.repository';

/**
 * Call-tracking attribution: the tracked number a call came through decides
 * its job source (inbound → the number dialed, outbound → our caller id).
 * Stamped once on the record so a later re-assignment of the number never
 * rewrites history.
 */
describe('CallsService.applyLifecycle — source stamping', () => {
  function make(
    existing: CallRecord | null,
    settings: Record<string, string> = {},
  ) {
    const upserts: CallRecord[] = [];
    const repo = {
      getBySid: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockImplementation(async (r: CallRecord) => {
        upserts.push(r);
      }),
    } as unknown as CallsRepository;
    const numberSettings = {
      get: jest.fn(async (phone: string) =>
        settings[phone] ? { phoneNumber: phone, sourceId: settings[phone] } : null,
      ),
    } as unknown as NumberSettingsRepository;
    const service = new CallsService(
      repo,
      undefined,
      undefined,
      undefined,
      numberSettings,
    );
    return { service, upserts, numberSettings };
  }

  it("stamps an inbound call with the dialed number's source", async () => {
    const { service, upserts } = make(null, {
      '+15412830739': 'src-google-ads',
    });
    await service.applyLifecycle({
      callSid: 'CA1',
      direction: 'inbound',
      from: '+14045551234',
      to: '+15412830739',
      status: 'ringing',
    });
    expect(upserts[0].sourceId).toBe('src-google-ads');
  });

  it('stamps an outbound call from our own caller id', async () => {
    const { service, upserts } = make(null, {
      '+15412830739': 'src-google-ads',
    });
    await service.applyLifecycle({
      callSid: 'CA2',
      direction: 'outbound',
      from: '+15412830739',
      to: '+14045551234',
      status: 'initiated',
    });
    expect(upserts[0].sourceId).toBe('src-google-ads');
  });

  it('never rewrites a source already on the record', async () => {
    const { service, upserts, numberSettings } = make(
      {
        callSid: 'CA1',
        direction: 'inbound',
        to: '+15412830739',
        sourceId: 'src-original',
        startedAt: '2026-08-05T10:00:00.000Z',
        updatedAt: '2026-08-05T10:00:00.000Z',
      },
      { '+15412830739': 'src-reassigned' },
    );
    await service.applyLifecycle({ callSid: 'CA1', status: 'completed' });

    expect(upserts[0].sourceId).toBeUndefined();
    expect(numberSettings.get).not.toHaveBeenCalled();
  });

  it('leaves the record unstamped when the number has no source', async () => {
    const { service, upserts } = make(null, {});
    await service.applyLifecycle({
      callSid: 'CA3',
      direction: 'inbound',
      from: '+14045551234',
      to: '+15550001111',
      status: 'ringing',
    });
    expect(upserts[0].sourceId).toBeUndefined();
  });

  it('uses the stored direction and number when the update lacks them', async () => {
    const { service, upserts } = make(
      {
        callSid: 'CA4',
        direction: 'inbound',
        to: '+15412830739',
        startedAt: '2026-08-05T10:00:00.000Z',
        updatedAt: '2026-08-05T10:00:00.000Z',
      },
      { '+15412830739': 'src-google-ads' },
    );
    await service.applyLifecycle({ callSid: 'CA4', status: 'completed' });
    expect(upserts[0].sourceId).toBe('src-google-ads');
  });

  it('survives a settings lookup failure', async () => {
    const upserts: CallRecord[] = [];
    const repo = {
      getBySid: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(async (r: CallRecord) => {
        upserts.push(r);
      }),
    } as unknown as CallsRepository;
    const numberSettings = {
      get: jest.fn().mockRejectedValue(new Error('ddb down')),
    } as unknown as NumberSettingsRepository;
    const service = new CallsService(
      repo,
      undefined,
      undefined,
      undefined,
      numberSettings,
    );

    await service.applyLifecycle({
      callSid: 'CA5',
      direction: 'inbound',
      to: '+15412830739',
      status: 'ringing',
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].sourceId).toBeUndefined();
  });
});
