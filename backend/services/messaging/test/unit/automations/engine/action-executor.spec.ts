import { NotImplementedException } from '@nestjs/common';
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
    user: jest.fn(async (id: string) => ({
      id,
      firstName: `Tech ${id}`,
      phone: `+1404555000${id.slice(-1)}`,
      email: `${id}@crew.test`,
      status: 'active',
    })),
    userIdsByRole: jest.fn(async () => ['t1']),
    ...(over.peers ?? {}),
  };
  const threads = {
    forTechnician: jest.fn(async (u: { id: string }) => createMockConversation({ id: `conv-${u.id}`, kind: 'team', partyKind: 'user', partyId: u.id })),
    ...(over.threads ?? {}),
  };
  const renderer = {
    render: jest.fn(async (input: { body?: string; subject?: string }) => ({
      body: (input.body ?? '').replace('{{first_name}}', 'Jane'),
      ...(input.subject !== undefined ? { subject: input.subject.replace('{{biz_name}}', 'Sure Lock') } : {}),
      missing: [],
    })),
    ...(over.renderer ?? {}),
  };
  const send = {
    sendSystem: jest.fn(async () => ({ message: createMockMessage({ id: 'm1', conversationId: 'c1', createdAt: T1 }), duplicate: false })),
    conversationForContact: jest.fn(async () => ({ conversation: createMockConversation(), created: false })),
    conversationForParty: jest.fn(async () => ({ conversation: createMockConversation({ id: 'c-num' }), created: true })),
    conversationForEmail: jest.fn(async (address: string) => ({
      conversation: createMockConversation({ id: 'c-mail', kind: 'unknown', partyKind: 'none', partyId: undefined, addresses: { phones: [], emails: [address] } }),
      created: true,
    })),
    ...(over.send ?? {}),
  };
  const fetchImpl = over.fetchImpl ?? jest.fn(async () => ({ ok: true, status: 200 }) as Response);
  const conversations = {
    getByParty: jest.fn(async () => createMockConversation({ id: 'c-existing' })),
    getByAddress: jest.fn(async () => ({ conversationId: 'c-existing' })),
    get: jest.fn(async () => createMockConversation({ id: 'c-existing' })),
    ...(over.conversations ?? {}),
  };
  const executor = new AutomationActionExecutor(
    peers as any,
    threads as any,
    renderer as any,
    send as any,
    fetchImpl as any,
    conversations as any,
  );
  return { executor, peers, threads, renderer, send, fetchImpl, conversations };
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
    expect(result).toMatchObject({ outcome: 'dry_run', body: 'Hi Jane', conversationId: 'c-existing' });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('a test run opens no thread and writes no pointer — it only reads', async () => {
    const { executor, send, threads, conversations } = harness();

    const [client] = await executor.run(sms(), ctx({ dryRun: true }));
    const techs = await executor.run(sms({ to: 'assigned_techs' }), ctx({ dryRun: true }));
    const [number] = await executor.run(sms({ to: 'number', number: '+14045559999' }), ctx({ dryRun: true }));

    expect([client, ...techs, number].every((r) => r.outcome === 'dry_run')).toBe(true);
    // None of the find-or-create paths ran: those write a thread and its ADDR# rows.
    expect(send.conversationForContact).not.toHaveBeenCalled();
    expect(send.conversationForParty).not.toHaveBeenCalled();
    expect(threads.forTechnician).not.toHaveBeenCalled();
    expect(conversations.getByParty).toHaveBeenCalledWith('contact', 'ct1');
    expect(conversations.getByAddress).toHaveBeenCalledWith('+14045559999');
  });

  it('a test run still renders for a recipient who has no thread yet', async () => {
    const { executor } = harness({
      conversations: { getByParty: jest.fn(async () => null), getByAddress: jest.fn(async () => null) },
    });
    const [result] = await executor.run(sms(), ctx({ dryRun: true }));
    expect(result).toMatchObject({ outcome: 'dry_run', body: 'Hi Jane' });
    expect(result.conversationId).toBeUndefined();
  });

  it('texts the caller back when a call rule has no job and no contact', async () => {
    const { executor, send } = harness();
    const callCtx = ctx({
      event: { kind: 'call.completed', at: NOW, call: { sid: 'CA1', outcome: 'missed', direction: 'inbound' } },
      facts: { call: { callSid: 'CA1', direction: 'inbound', status: 'no-answer', from: '+14045551234', to: '+14045550000' } },
      entity: 'call:CA1',
      occurrence: 'call:CA1',
    });
    const [result] = await executor.run(sms(), callCtx);

    expect(send.conversationForParty).toHaveBeenCalledWith({ phone: '+14045551234' });
    expect(result).toMatchObject({ to: 'client', outcome: 'sent' });

    // On an outbound call the client is the number we dialled.
    const { executor: out, send: outSend } = harness();
    await out.run(
      sms(),
      ctx({
        ...callCtx,
        facts: { call: { callSid: 'CA2', direction: 'outbound', status: 'completed', from: '+14045550000', to: '+14045557777' } },
      }),
    );
    expect(outSend.conversationForParty).toHaveBeenCalledWith({ phone: '+14045557777' });
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

  it('reports in-app, tag and status actions as unsupported instead of pretending', async () => {
    const { executor } = harness();
    for (const type of ['send_in_app', 'add_tag', 'change_sub_status'] as const) {
      const [result] = await executor.run({ type } as AutomationAction, ctx());
      expect(result.outcome).toBe('unsupported');
      expect(result.error).toBeTruthy();
    }
  });
});

// --- send_email: Workiz "Notify by Email" / "Both" (A10). The 2 304 e-mails
// the account's automations sent in 2026 (OOA jobs, Key Kiosk, the Facebook
// campaigns) all go through here.

const email = (over: Partial<AutomationAction> = {}): AutomationAction => ({
  type: 'send_email',
  to: 'client',
  subject: 'Your appointment with {{biz_name}}',
  body: 'Hi {{first_name}}\nSee you soon',
  ...over,
});

/** A client thread that knows the contact's e-mail (copied from CRM when it was opened). */
const clientWithEmail = () => ({
  conversationForContact: jest.fn(async () => ({
    conversation: createMockConversation({ addresses: { phones: ['+14045551234'], emails: ['jane@example.com'] } }),
    created: false,
  })),
});

describe('AutomationActionExecutor — send_email', () => {
  it("e-mails the client at their thread's address, subject and body rendered, under the same replay-proof key", async () => {
    const { executor, send, renderer } = harness({ send: clientWithEmail() });
    const [result] = await executor.run(email(), ctx({ index: 1 }));

    expect(result).toMatchObject({
      type: 'send_email',
      to: 'client',
      outcome: 'sent',
      messageId: 'm1',
      subject: 'Your appointment with Sure Lock',
      body: 'Hi Jane\nSee you soon',
    });
    expect(send.sendSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        to: 'jane@example.com',
        subject: 'Your appointment with Sure Lock',
        body: 'Hi Jane\nSee you soon',
        origin: 'automation',
        automationRuleId: 'r1',
        dealId: 'd1',
        actorId: 'system:automations',
        clientMessageId: expect.stringMatching(/^automation:r1:deal:d1:[0-9a-f]{16}:1:contact:ct1$/),
      }),
    );
    // A plain text renders as text: `sendSystem` escapes it and turns the
    // line breaks into <br> exactly once. Escaping it here too would mail
    // "Sure Lock &amp;amp; Key".
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'text', subject: 'Your appointment with {{biz_name}}', body: 'Hi {{first_name}}\nSee you soon' }),
      expect.objectContaining({ contactId: 'ct1', dealId: 'd1' }),
    );
  });

  it('an imported HTML body keeps its markup: rendered as html, so the values are escaped and the tags are not', async () => {
    const { executor, renderer } = harness({ send: clientWithEmail() });
    await executor.run(email({ body: '<p>Hi {{first_name}}</p>' }), ctx());
    expect(renderer.render).toHaveBeenCalledWith(expect.objectContaining({ format: 'html' }), expect.anything());
  });

  it('e-mails every assigned technician at their work address in their team thread; one without an address is skipped as "no email"', async () => {
    const { executor, send } = harness({
      peers: {
        user: jest.fn(async (id: string) => ({
          id,
          firstName: `Tech ${id}`,
          ...(id === 't1' ? { email: 't1@crew.test' } : {}),
          status: 'active',
        })),
      },
    });
    const results = await executor.run(email({ to: 'assigned_techs' }), ctx());

    expect(results).toEqual([
      expect.objectContaining({ type: 'send_email', to: 'tech Tech t1', outcome: 'sent' }),
      expect.objectContaining({ type: 'send_email', to: 'tech Tech t2', outcome: 'skipped', error: 'no email' }),
    ]);
    expect(send.sendSystem).toHaveBeenCalledTimes(1);
    expect(send.sendSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        to: 't1@crew.test',
        conversation: expect.objectContaining({ id: 'conv-t1', kind: 'team' }),
        clientMessageId: expect.stringMatching(/:0:user:t1$/),
      }),
    );
  });

  it('a client whose thread has no e-mail address is skipped as "no email", never failed', async () => {
    const { executor, send } = harness();
    const [result] = await executor.run(email(), ctx());
    expect(result).toEqual({ type: 'send_email', to: 'client', outcome: 'skipped', error: 'no email' });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it("uses the rule's name as the subject when the action has none", async () => {
    const { executor, send } = harness({ send: clientWithEmail() });
    const [result] = await executor.run(email({ subject: undefined }), ctx({ ruleName: 'OOA jobs' }));
    expect(result).toMatchObject({ outcome: 'sent', subject: 'OOA jobs' });
    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ subject: 'OOA jobs' }));

    const { executor: nameless } = harness({ send: clientWithEmail() });
    const [skipped] = await nameless.run(email({ subject: '  ' }), ctx());
    expect(skipped).toMatchObject({ outcome: 'skipped', error: 'no subject' });
  });

  it('says so when e-mail is not configured, and records opt-outs and failures like a text', async () => {
    const cases: Array<[Error, Record<string, string>]> = [
      [
        new NotImplementedException('Email sending is not configured (MESSAGING_EMAIL_FROM)'),
        { outcome: 'skipped', error: 'email is not configured (MESSAGING_EMAIL_FROM)' },
      ],
      [new RecipientOptedOutException('jane@example.com', 'email'), { outcome: 'skipped', error: 'opted out' }],
      [new Error('ses down'), { outcome: 'failed', error: 'ses down' }],
    ];
    for (const [thrown, expected] of cases) {
      const { executor } = harness({
        send: {
          ...clientWithEmail(),
          sendSystem: jest.fn(async () => {
            throw thrown;
          }),
        },
      });
      const [result] = await executor.run(email(), ctx());
      expect(result).toMatchObject(expected);
    }
  });

  it('a test run renders and resolves the address but sends nothing and opens nothing', async () => {
    const { executor, send, threads, conversations } = harness({
      conversations: {
        getByParty: jest.fn(async () => createMockConversation({ id: 'c-existing', addresses: { phones: [], emails: ['jane@example.com'] } })),
      },
    });
    const [client] = await executor.run(email(), ctx({ dryRun: true }));
    expect(client).toMatchObject({
      outcome: 'dry_run',
      to: 'client',
      subject: 'Your appointment with Sure Lock',
      body: 'Hi Jane\nSee you soon',
      conversationId: 'c-existing',
    });

    const techs = await executor.run(email({ to: 'assigned_techs' }), ctx({ dryRun: true }));
    expect(techs.every((r) => r.outcome === 'dry_run')).toBe(true);

    expect(send.sendSystem).not.toHaveBeenCalled();
    expect(send.conversationForContact).not.toHaveBeenCalled();
    expect(send.conversationForEmail).not.toHaveBeenCalled();
    expect(threads.forTechnician).not.toHaveBeenCalled();
    expect(conversations.getByParty).toHaveBeenCalledWith('contact', 'ct1');
  });

  it('"Both" is one rule with a text and an e-mail: each action sends on its own channel under its own key', async () => {
    const { executor, send } = harness({ send: clientWithEmail() });
    const [text] = await executor.run(sms(), ctx({ index: 0 }));
    const [mail] = await executor.run(email(), ctx({ index: 1 }));

    expect(text.outcome).toBe('sent');
    expect(mail.outcome).toBe('sent');
    const calls: Array<{ channel?: string; clientMessageId: string }> = send.sendSystem.mock.calls.map(
      (c: [{ channel?: string; clientMessageId: string }]) => c[0],
    );
    expect(calls.map((c) => c.channel ?? 'sms')).toEqual(['sms', 'email']);
    expect(calls[0].clientMessageId).not.toBe(calls[1].clientMessageId);
  });

  it('e-mails a bare address through the thread an inbound mail from it would open', async () => {
    const { executor, send } = harness();
    const [result] = await executor.run(email({ to: 'number', email: ' Office@Partner.test ' }), ctx());

    expect(send.conversationForEmail).toHaveBeenCalledWith('office@partner.test');
    expect(result).toMatchObject({ to: 'office@partner.test', outcome: 'sent' });
    expect(send.sendSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        to: 'office@partner.test',
        conversation: expect.objectContaining({ id: 'c-mail' }),
        clientMessageId: expect.stringMatching(/:0:email:office@partner\.test$/),
      }),
    );

    // The same recipient on a text action has no number to text.
    const { executor: texting, send: notTexting } = harness();
    const [noPhone] = await texting.run(sms({ to: 'number', number: undefined, email: 'office@partner.test' }), ctx());
    expect(noPhone).toMatchObject({ outcome: 'skipped', error: 'no phone' });
    expect(notTexting.sendSystem).not.toHaveBeenCalled();
  });
});
