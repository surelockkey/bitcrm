import { FlowRunnerService } from 'src/voice/flow-runner.service';

/**
 * The technician dial-in's last step: the code named a client number, the
 * caller confirmed the name, and the conference opens. When that number has
 * an extension, the conference must press it once the client answers.
 */
const CONFIG = { publicBaseUrl: 'https://api.test' } as never;

function build(match: Record<string, unknown>) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    },
  };
  const conference = {
    initOutbound: jest.fn(async () => undefined),
    initInbound: jest.fn(async () => undefined),
    sharedConferenceAttrs: jest.fn(() => ({})),
  };
  const calls = {
    applyLifecycle: jest.fn(async () => undefined),
    recordFlowStep: jest.fn(async () => undefined),
    getBySid: jest.fn(async () => null),
  };
  const dialIn = { resolve: jest.fn(async () => match) };
  const runner = new FlowRunnerService(
    CONFIG,
    { findByNumber: jest.fn(async () => null) } as never,
    {} as never,
    conference as never,
    calls as never,
    redis as never,
    dialIn as never,
  );
  return { runner, conference };
}

const MATCH = {
  dealId: 'deal-1',
  dealNumber: 'K4T9ZW',
  technicianId: 'tech-1',
  clientName: 'Maria Alvarez',
  to: '+14045555678',
  from: '+14045550100',
  callerIdSource: 'area',
};

describe('FlowRunnerService — connecting a dial-in to the client', () => {
  it('presses the client’s extension once they answer', async () => {
    const { runner, conference } = build({ ...MATCH, extension: '102' });
    await runner.startTechnicianLine('CA1', '+14045550134', '+15412830739');
    await runner.resume('CA1', 'dial-in', '6100');

    const twiml = await runner.resume('CA1', 'dial-in', '1');

    expect(twiml).toContain('<Conference');
    expect(conference.initOutbound).toHaveBeenCalledWith(
      'CA1',
      'tech-1',
      '+14045555678',
      '+14045550100',
      expect.objectContaining({ dealId: 'deal-1', sendDigits: 'ww102' }),
    );
  });

  it('presses nothing for a number without an extension', async () => {
    const { runner, conference } = build(MATCH);
    await runner.startTechnicianLine('CA1', '+14045550134', '+15412830739');
    await runner.resume('CA1', 'dial-in', '4729');

    await runner.resume('CA1', 'dial-in', '1');

    const options = (conference.initOutbound.mock.calls[0] as unknown[])[4] as Record<string, unknown>;
    expect(options.sendDigits).toBeUndefined();
  });
});
