import {
  CallsService,
  agentFromEndpoint,
} from '../../src/calls/calls.service';
import { CallsRepository } from '../../src/calls/calls.repository';

describe('agentFromEndpoint', () => {
  it('extracts the identity from a client endpoint', () => {
    expect(agentFromEndpoint('client:user-abc')).toBe('user-abc');
  });
  it('returns undefined for a PSTN number', () => {
    expect(agentFromEndpoint('+14045551234')).toBeUndefined();
    expect(agentFromEndpoint(undefined)).toBeUndefined();
  });
});

describe('CallsService.recordStatus', () => {
  function make() {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const repo = {
      upsert,
      getBySid: jest.fn().mockResolvedValue(null),
    } as unknown as CallsRepository;
    return { service: new CallsService(repo), upsert };
  }

  it('maps an outbound status callback and resolves the agent from From', async () => {
    const { service, upsert } = make();
    await service.recordStatus(
      {
        CallSid: 'CA123',
        CallStatus: 'in-progress',
        From: 'client:agent-1',
        To: '+14045551234',
        Direction: 'outbound-dial',
        CallDuration: '42',
      },
      '2026-07-27T00:00:00.000Z',
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: 'CA123',
        status: 'in-progress',
        agentId: 'agent-1',
        to: '+14045551234',
        durationSeconds: 42,
      }),
    );
  });

  it('ignores a callback with no CallSid', async () => {
    const { service, upsert } = make();
    await service.recordStatus({});
    expect(upsert).not.toHaveBeenCalled();
  });
});
