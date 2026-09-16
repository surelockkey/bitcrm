import { type AutomationAction } from '@bitcrm/types';
import {
  AutomationActionExecutor,
  type ActionContext,
} from '../../../../src/automations/engine/action-executor';
import { type AutomationFacts } from '../../../../src/automations/engine/facts';
import { RecipientOptedOutException } from '../../../../src/outbound/send.service';
import { createMockConversation, createMockMessage, T1 } from '../../mocks';

const NOW = '2026-09-16T15:00:00.000Z';

const facts: AutomationFacts = {
  deal: {
    id: 'd1',
    contactId: 'ct1',
    superStatus: 'submitted',
    assignedTechIds: ['t1', 't2'],
    assignedDispatcherId: 'u-disp',
  },
};

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  ruleId: 'r1',
  event: { kind: 'deal.status_changed', at: NOW, dealId: 'd1' },
  facts,
  entity: 'deal:d1',
  occurrence: 'status:submitted>done',
  index: 0,
  ...over,
});

function harness(over: Record<string, any> = {}) {
  const peers = {
    deal: jest.fn(),
    user: jest.fn(async (id: string) => ({ id, firstName: `Tech ${id}`, phone: `+1404555000${id.slice(-1)}`, status: 'active' })),
    userIdsByRole: jest.fn(async () => ['t1']),
    ...(over.peers ?? {}),
  };
  const threads = {
    forTechnician: jest.fn(async (u: { id: string }) => createMockConversation({ id: `conv-${u.id}`, kind: 'team', partyKind: 'user', partyId: u.id })),
    ...(over.threads ?? {}),
  };
  const renderer = {
    render: jest.fn(async (input: { body?: string }) => ({ body: (input.body ?? '').replace('{{first_name}}', 'Jane'), missing: [] })),
    ...(over.renderer ?? {}),
  };
  const send = {
    sendSystem: jest.fn(async () => ({ message: createMockMessage({ id: 'm1', conversationId: 'c1', createdAt: T1 }), duplicate: false })),
    conversationForContact: jest.fn(async () => ({ conversation: createMockConversation(), created: false })),
    conversationForParty: jest.fn(async () => ({ conversation: createMockConversation({ id: 'c-num' }), created: true })),
    ...(over.send ?? {}),
  };
  const fetchImpl = over.fetchImpl ?? jest.fn(async () => ({ ok: true, status: 200 }) as Response);
  const executor = new AutomationActionExecutor(
    peers as any,
    threads as any,
    renderer as any,
    send as any,
    fetchImpl as any,
  );
  return { executor, peers, threads, renderer, send, fetchImpl };
}

const sms = (over: Partial<AutomationAction> = {}): AutomationAction => ({
  type: 'send_sms',
  to: 'client',
  body: 'Hi {{first_name}}',
  ...over,
});

describe('AutomationActionExecutor', () => {
  it('texts the client in their thread with a replay-proof key', async () => {
    const { executor, send } = harness();
    const [result] = await executor.run(sms(), ctx());

    expect(result).toMatchObject({ type: 'send_sms', to: 'client', outcome: 'sent', messageId: 'm1', body: 'Hi Jane' });
    expect(send.sendSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Hi Jane',
        origin: 'automation',
        automationRuleId: 'r1',
        dealId: 'd1',
        actorId: 'system:automations',
        clientMessageId: expect.stringMatching(/^automation:r1:deal:d1:[0-9a-f]{16}:0:contact:ct1$/),
      }),
    );
  });

  it('the same firing computes the same key twice (a redelivery is a duplicate, not a second text)', async () => {
    const { executor, send } = harness({
      send: { sendSystem: jest.fn(async () => ({ message: createMockMessage(), duplicate: true })) },
    });
    const first = await executor.run(sms(), ctx());
    const second = await executor.run(sms(), ctx());
    expect(first[0].outcome).toBe('duplicate');
    expect(send.sendSystem.mock.calls[0][0].clientMessageId).toBe(send.sendSystem.mock.calls[1][0].clientMessageId);
    expect(second[0].outcome).toBe('duplicate');
  });

  it('texts every assigned technician in their own thread', async () => {
    const { executor, threads } = harness();
    const results = await executor.run(sms({ to: 'assigned_techs' }), ctx());
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === 'sent')).toBe(true);
    expect(threads.forTechnician).toHaveBeenCalledTimes(2);
  });

  it('skips an inactive or unreadable recipient without failing the rest', async () => {
    const { executor } = harness({
      peers: {
        user: jest.fn(async (id: string) =>
          id === 't1' ? null : { id, firstName: 'Ann', phone: '+14045550002', status: 'inactive' },
        ),
      },
    });
    const results = await executor.run(sms({ to: 'assigned_techs' }), ctx());
    expect(results).toEqual([{ type: 'send_sms', to: 'assigned_techs', outcome: 'skipped', error: 'no recipient resolved' }]);
  });

  it('records an opted-out recipient as skipped, never as a failure', async () => {
    const { executor } = harness({
      send: {
        sendSystem: jest.fn(async () => {
          throw new RecipientOptedOutException('+14045551234');
        }),
      },
    });
    const [result] = await executor.run(sms(), ctx());
    expect(result).toMatchObject({ outcome: 'skipped', error: 'opted out' });
  });

  it('records a send failure with its message', async () => {
    const { executor } = harness({
      send: {
        sendSystem: jest.fn(async () => {
          throw new Error('twilio down');
        }),
      },
    });
    const [result] = await executor.run(sms(), ctx());
    expect(result).toMatchObject({ outcome: 'failed', error: 'twilio down' });
  });

  it('a blank rendered text sends nothing', async () => {
    const { executor, send } = harness({ renderer: { render: jest.fn(async () => ({ body: '   ', missing: [] })) } });
    const [result] = await executor.run(sms(), ctx());
    expect(result).toMatchObject({ outcome: 'skipped', error: 'the text rendered empty' });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('a test run renders and resolves but sends nothing', async () => {
    const { executor, send } = harness();
    const [result] = await executor.run(sms(), ctx({ dryRun: true }));
    expect(result).toMatchObject({ outcome: 'dry_run', body: 'Hi Jane' });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('resolves role recipients through the directory', async () => {
    const { executor, peers } = harness();
    const results = await executor.run(sms({ to: 'role', roleIds: ['role-dispatch'] }), ctx());
    expect(peers.userIdsByRole).toHaveBeenCalledWith('role-dispatch');
    expect(results[0].outcome).toBe('sent');
  });

  it('texts a bare number through its own thread', async () => {
    const { executor, send } = harness();
    const [result] = await executor.run(sms({ to: 'number', number: '+14045559999' }), ctx());
    expect(send.conversationForParty).toHaveBeenCalledWith({ phone: '+14045559999' });
    expect(result).toMatchObject({ to: '+14045559999', outcome: 'sent' });
  });

  it('posts a webhook with the default payload and reports the status', async () => {
    const { executor, fetchImpl } = harness();
    const [ok] = await executor.run({ type: 'webhook', url: 'https://example.test/hook' }, ctx());
    expect(ok).toMatchObject({ type: 'webhook', outcome: 'sent', statusCode: 200 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ ruleId: 'r1', event: 'deal.status_changed' });

    const { executor: failing } = harness({ fetchImpl: jest.fn(async () => ({ ok: false, status: 503 }) as Response) });
    const [bad] = await failing.run({ type: 'webhook', url: 'https://example.test/hook' }, ctx());
    expect(bad).toMatchObject({ outcome: 'failed', statusCode: 503 });
  });

  it('reports email, in-app, tag and status actions as unsupported instead of pretending', async () => {
    const { executor } = harness();
    for (const type of ['send_email', 'send_in_app', 'add_tag', 'change_sub_status'] as const) {
      const [result] = await executor.run({ type } as AutomationAction, ctx());
      expect(result.outcome).toBe('unsupported');
      expect(result.error).toBeTruthy();
    }
  });
});
