import { CallsService } from '../../src/calls/calls.service';
import {
  CallsRepository,
  type CallRecord,
} from '../../src/calls/calls.repository';
import { NumberSettingsRepository } from '../../src/numbers/number-settings.repository';
import { CallFlowsService } from '../../src/call-flows/call-flows.service';

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
        businessProfileId: 'bp-original',
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

/**
 * Company (business profile) attribution, stamped at the same point as the
 * source: the number's own setting → the flow that answers the number → none.
 */
describe('CallsService.applyLifecycle — company stamping', () => {
  function make(
    existing: CallRecord | null,
    settings: Record<string, { sourceId?: string; businessProfileId?: string }> = {},
    flows: Record<string, { businessProfileId?: string }> = {},
  ) {
    const upserts: CallRecord[] = [];
    const repo = {
      getBySid: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockImplementation(async (r: CallRecord) => {
        upserts.push(r);
      }),
    } as unknown as CallsRepository;
    const numberSettings = {
      get: jest.fn(async (phone: string) => (settings[phone] ? { phoneNumber: phone, ...settings[phone] } : null)),
    } as unknown as NumberSettingsRepository;
    const callFlows = {
      findByNumber: jest.fn(async (phone: string) => (flows[phone] ? { id: 'f1', ...flows[phone] } : null)),
    } as unknown as CallFlowsService;
    const service = new CallsService(repo, undefined, undefined, undefined, numberSettings, undefined, callFlows);
    return { service, upserts, numberSettings, callFlows };
  }

  const inbound = { callSid: 'CA1', direction: 'inbound' as const, from: '+14045551234', to: '+15412830739', status: 'ringing' as const };

  it("uses the number's own company first", async () => {
    const { service, upserts, callFlows } = make(
      null,
      { '+15412830739': { sourceId: 'src-1', businessProfileId: 'bp-number' } },
      { '+15412830739': { businessProfileId: 'bp-flow' } },
    );
    await service.applyLifecycle(inbound);
    expect(upserts[0]).toMatchObject({ sourceId: 'src-1', businessProfileId: 'bp-number' });
    expect(callFlows.findByNumber).not.toHaveBeenCalled();
  });

  it('falls back to the company of the flow that answers the number', async () => {
    const { service, upserts, callFlows } = make(
      null,
      { '+15412830739': { sourceId: 'src-1' } },
      { '+15412830739': { businessProfileId: 'bp-flow' } },
    );
    await service.applyLifecycle(inbound);
    expect(callFlows.findByNumber).toHaveBeenCalledWith('+15412830739');
    expect(upserts[0]).toMatchObject({ sourceId: 'src-1', businessProfileId: 'bp-flow' });
  });

  it('stamps an outbound call from our caller id', async () => {
    const { service, upserts } = make(null, {}, { '+15412830739': { businessProfileId: 'bp-flow' } });
    await service.applyLifecycle({ callSid: 'CA2', direction: 'outbound', from: '+15412830739', to: '+14045551234', status: 'initiated' });
    expect(upserts[0].businessProfileId).toBe('bp-flow');
    expect(upserts[0].sourceId).toBeUndefined();
  });

  it('leaves it unset when neither the number nor a flow names a company', async () => {
    const { service, upserts } = make(null, { '+15412830739': { sourceId: 'src-1' } });
    await service.applyLifecycle(inbound);
    expect(upserts[0].businessProfileId).toBeUndefined();
    expect(upserts[0].sourceId).toBe('src-1');
  });

  it('never rewrites a stamped company, but fills a missing one without touching the source', async () => {
    const stamped = make(
      { callSid: 'CA1', direction: 'inbound', to: '+15412830739', businessProfileId: 'bp-old', startedAt: 'x', updatedAt: 'x' },
      { '+15412830739': { sourceId: 'src-1', businessProfileId: 'bp-new' } },
    );
    await stamped.service.applyLifecycle({ callSid: 'CA1', status: 'completed' });
    expect(stamped.upserts[0].businessProfileId).toBeUndefined();
    // The source was still missing, so it is filled.
    expect(stamped.upserts[0].sourceId).toBe('src-1');

    const sourced = make(
      { callSid: 'CA1', direction: 'inbound', to: '+15412830739', sourceId: 'src-old', startedAt: 'x', updatedAt: 'x' },
      { '+15412830739': { sourceId: 'src-new', businessProfileId: 'bp-new' } },
    );
    await sourced.service.applyLifecycle({ callSid: 'CA1', status: 'completed' });
    expect(sourced.upserts[0].sourceId).toBeUndefined();
    expect(sourced.upserts[0].businessProfileId).toBe('bp-new');
  });

  it('survives a flow lookup failure', async () => {
    const { service, upserts, callFlows } = make(null, {});
    (callFlows.findByNumber as jest.Mock).mockRejectedValueOnce(new Error('ddb down'));
    await service.applyLifecycle(inbound);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].businessProfileId).toBeUndefined();
  });
});
