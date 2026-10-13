import { Logger } from '@nestjs/common';
import { ConnectivityCheckService } from '../../../src/connectivity/connectivity-check.service';
import { Probe, ProbeKind } from '../../../src/connectivity/connectivity.types';

/** A probe whose answer can be flipped mid-test — a peer that finishes booting. */
const switchable = (name: string, kind: ProbeKind, initiallyOk: boolean) => {
  const state = { ok: initiallyOk, calls: 0 };
  const probe: Probe = {
    name,
    kind,
    run: async () => {
      state.calls += 1;
      return state.ok ? { ok: true, message: 'HTTP 200' } : Promise.reject(new Error('fetch failed'));
    },
  };
  return { probe, state };
};

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ConnectivityCheckService — peers still booting', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const reports = (spy: jest.SpyInstance) =>
    spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('Connectivity Report'));

  it('holds the report while only peer services are down, and prints it healthy once they answer', async () => {
    const redis = switchable('redis', 'redis', true);
    const deal = switchable('deal', 'http', false);
    const svc = new ConnectivityCheckService([redis.probe, deal.probe], {
      serviceName: 'x',
      peerSettleIntervalMs: 10,
      peerSettleTimeoutMs: 1000,
    });

    await svc.onApplicationBootstrap();
    expect(reports(warn)).toHaveLength(0); // nothing alarming printed at boot

    deal.state.ok = true;
    await tick(60);

    expect(reports(warn)).toHaveLength(0);
    expect(reports(log)).toHaveLength(1);
    expect(reports(log)[0]).toContain('Boot status: healthy');
    expect(svc.getSnapshot().results.every((r) => r.ok)).toBe(true);
    svc.onApplicationShutdown();
  });

  it('prints the degraded report at the deadline when a peer never answers', async () => {
    const deal = switchable('deal', 'http', false);
    const svc = new ConnectivityCheckService([deal.probe], {
      serviceName: 'x',
      peerSettleIntervalMs: 10,
      peerSettleTimeoutMs: 50,
    });

    await svc.onApplicationBootstrap();
    await tick(120);

    expect(reports(warn)).toHaveLength(1);
    expect(reports(warn)[0]).toContain('deal');
    expect(reports(warn)[0]).toContain('degraded (1 issue)');
    svc.onApplicationShutdown();
  });

  it('prints at once when a non-peer dependency is down — no waiting for infrastructure', async () => {
    const redis = switchable('redis', 'redis', false);
    const deal = switchable('deal', 'http', false);
    const svc = new ConnectivityCheckService([redis.probe, deal.probe], {
      serviceName: 'x',
      peerSettleIntervalMs: 10,
      peerSettleTimeoutMs: 1000,
    });

    await svc.onApplicationBootstrap();

    expect(reports(warn)).toHaveLength(1);
    svc.onApplicationShutdown();
  });

  it('stops retrying peers on shutdown', async () => {
    const deal = switchable('deal', 'http', false);
    const svc = new ConnectivityCheckService([deal.probe], {
      serviceName: 'x',
      peerSettleIntervalMs: 10,
      peerSettleTimeoutMs: 1000,
    });

    await svc.onApplicationBootstrap();
    svc.onApplicationShutdown();
    const calls = deal.state.calls;
    await tick(50);

    expect(deal.state.calls).toBe(calls);
  });
});
