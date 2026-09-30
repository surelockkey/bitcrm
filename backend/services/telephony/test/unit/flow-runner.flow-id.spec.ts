import { FlowRunnerService } from 'src/voice/flow-runner.service';
import type { CallFlow } from '@bitcrm/types';

/**
 * Call Tracking groups a period's calls by the flow that answered them, and a
 * flow can be renamed: the record has to carry the flow's id beside its name,
 * or a rename splits one flow into two rows.
 */
const FLOW: CallFlow = {
  id: 'flow-sure-ct',
  name: '(2-CT-O) SURE CT ORGANIC',
  numbers: ['+12034036303'],
  entryNodeId: 'hello',
  nodes: { hello: { id: 'hello', type: 'say', text: 'Thanks for calling.' } },
  active: true,
  version: 1,
  createdBy: 'u1',
  createdAt: '',
  updatedAt: '',
};

function build(flow: CallFlow | null) {
  const store = new Map<string, string>();
  const redis = {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    },
  };
  const calls = {
    applyLifecycle: jest.fn(async () => undefined),
    recordFlowStep: jest.fn(async () => undefined),
    getBySid: jest.fn(async () => null),
  };
  const runner = new FlowRunnerService(
    { publicBaseUrl: 'https://api.test' } as never,
    { findByNumber: jest.fn(async () => flow) } as never,
    { findRaw: jest.fn(), resolveTargets: jest.fn(async () => []) } as never,
    { initInbound: jest.fn(), sharedConferenceAttrs: jest.fn(() => ({})) } as never,
    calls as never,
    redis as never,
  );
  return { runner, calls };
}

describe('FlowRunnerService — the flow is recorded by id as well as name', () => {
  it('stamps flowId next to flowName when a stored flow answers', async () => {
    const { runner, calls } = build(FLOW);

    await runner.startInbound('CA1', '+14045551234', '+12034036303');

    expect(calls.applyLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        callSid: 'CA1',
        flowName: '(2-CT-O) SURE CT ORGANIC',
        flowId: 'flow-sure-ct',
      }),
    );
  });

  it('leaves the built-in technician line without a catalog id', async () => {
    const { runner, calls } = build(null);

    await runner.startTechnicianLine('CA1', '+14045550134', '+12034036303');

    const written = (calls.applyLifecycle.mock.calls as unknown as Array<[Record<string, unknown>]>).map(
      ([u]) => u,
    );
    const labelled = written.find((u) => u.flowName === 'Technician line');
    expect(labelled).toBeDefined();
    expect(labelled).not.toHaveProperty('flowId');
  });
});
