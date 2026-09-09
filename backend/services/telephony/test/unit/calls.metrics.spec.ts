import type { BusinessMetricsService } from '@bitcrm/shared';
import { CallsService } from '../../src/calls/calls.service';
import {
  CallsRepository,
  type CallRecord,
} from '../../src/calls/calls.repository';

/**
 * Telephony was the one service emitting no business metrics at all, so the
 * Grafana business dashboard showed nothing for calls. applyLifecycle is the
 * single lifecycle writer, so it is the only place these can be counted
 * without double-counting out-of-order webhooks.
 */
describe('CallsService.applyLifecycle — business metrics', () => {
  function make(existing: CallRecord | null) {
    const repo = {
      getBySid: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as CallsRepository;

    const metrics = {
      callsAnswered: { inc: jest.fn() },
      callsCompleted: { inc: jest.fn() },
      callDuration: { observe: jest.fn() },
    } as unknown as BusinessMetricsService;

    const service = new CallsService(
      repo,
      undefined,
      undefined,
      undefined,
      undefined,
      metrics,
    );
    return { service, metrics: metrics as any };
  }

  const base: CallRecord = {
    callSid: 'CA1',
    status: 'in-progress',
    direction: 'inbound',
    startedAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
  };

  it('counts a call as answered on the first answeredAt', async () => {
    const { service, metrics } = make({ ...base, answeredAt: undefined });

    await service.applyLifecycle({
      callSid: 'CA1',
      answeredAt: '2026-08-05T10:00:05.000Z',
    });

    expect(metrics.callsAnswered.inc).toHaveBeenCalledWith({
      direction: 'inbound',
    });
  });

  // Twilio re-POSTs the status callback; the answered count must not climb.
  it('does not re-count an already answered call', async () => {
    const { service, metrics } = make({
      ...base,
      answeredAt: '2026-08-05T10:00:05.000Z',
    });

    await service.applyLifecycle({
      callSid: 'CA1',
      answeredAt: '2026-08-05T10:00:05.000Z',
    });

    expect(metrics.callsAnswered.inc).not.toHaveBeenCalled();
  });

  it('counts a completed call with its terminal status', async () => {
    const { service, metrics } = make(base);

    await service.applyLifecycle({ callSid: 'CA1', status: 'no-answer' });

    expect(metrics.callsCompleted.inc).toHaveBeenCalledWith({
      direction: 'inbound',
      status: 'no-answer',
    });
  });

  it('observes talk time when the call completes', async () => {
    const { service, metrics } = make({
      ...base,
      answeredAt: '2026-08-05T10:00:00.000Z',
    });

    await service.applyLifecycle({
      callSid: 'CA1',
      status: 'completed',
      endedAt: '2026-08-05T10:02:00.000Z',
    });

    expect(metrics.callDuration.observe).toHaveBeenCalledWith(
      { direction: 'inbound' },
      120,
    );
  });

  // A late duplicate terminal webhook is dropped by the status guard; the
  // metric has to be dropped with it or completions are counted twice.
  it('does not count a terminal status that the guard dropped', async () => {
    const { service, metrics } = make({ ...base, status: 'busy' });

    await service.applyLifecycle({ callSid: 'CA1', status: 'completed' });

    expect(metrics.callsCompleted.inc).not.toHaveBeenCalled();
    expect(metrics.callDuration.observe).not.toHaveBeenCalled();
  });

  it('labels an unknown direction rather than dropping the sample', async () => {
    const { service, metrics } = make({ ...base, direction: undefined });

    await service.applyLifecycle({ callSid: 'CA1', status: 'failed' });

    expect(metrics.callsCompleted.inc).toHaveBeenCalledWith({
      direction: 'unknown',
      status: 'failed',
    });
  });

  it('works without a metrics service injected', async () => {
    const repo = {
      getBySid: jest.fn().mockResolvedValue(base),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as CallsRepository;
    const service = new CallsService(repo);

    await expect(
      service.applyLifecycle({ callSid: 'CA1', status: 'completed' }),
    ).resolves.toBeDefined();
  });
});
