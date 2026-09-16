import { type MessagingSettings } from '@bitcrm/types';
import { type AutomationDeal } from '../../../src/automations/internal/peers.client';
import { AutomationDisabledException, TECH_NOTICE_DEDUP_WINDOW_MS, TechNoticesService } from '../../../src/automations/tech-notices.service';
import { RecipientOptedOutException } from '../../../src/outbound/send.service';
import { ADMIN, TECH, adminPerms, techPerms } from '../api/api-mocks';
import { createMockConversation, createMockMessage } from '../mocks';

const ON_MY_WAY = 'Hi {{first_name}}, this is {{tech_assigned}}. On my way!';
const LATE = 'Hi {{first_name}}, I will be {{late_value}} minutes late.';
const UUID = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';

function makeService(opts: {
  deal?: AutomationDeal | null;
  rules?: Partial<Record<'on-my-way' | 'late', boolean>>;
  settings?: Partial<MessagingSettings>;
  optedOut?: boolean;
} = {}) {
  const rules = { isEnabled: jest.fn(async (id: 'on-my-way' | 'late') => opts.rules?.[id] ?? true) };
  const settings = { get: jest.fn(async () => ({ onMyWayMsg: ON_MY_WAY, lateMsg: LATE, ...(opts.settings ?? {}) })) };
  const peers = {
    deal: jest.fn(async () => (opts.deal === undefined ? { id: 'd1', contactId: 'ct1', assignedTechIds: [TECH.id], scheduledDate: '2026-09-20' } : opts.deal)),
  };
  const conversation = createMockConversation({ id: 'c-client', partyId: 'ct1' });
  const renderer = { render: jest.fn(async (input: { body: string }, refs: { values?: Record<string, string> }) => ({ body: `${input.body} [${JSON.stringify(refs.values)}]`, missing: [] })) };
  const send = {
    conversationForContact: jest.fn(async () => ({ conversation, created: false })),
    sendSystem: jest.fn(async (input: { body: string }) => {
      if (opts.optedOut) throw new RecipientOptedOutException('+14045551234');
      return { duplicate: false, message: createMockMessage({ id: 'm-notice', conversationId: 'c-client', direction: 'outbound', status: 'queued', body: input.body }) };
    }),
  };
  const service = new TechNoticesService(rules as any, settings as any, peers as any, renderer as any, send as any);
  return { service, rules, settings, peers, renderer, send, conversation };
}

const techCaller = { user: TECH, perms: techPerms() };

describe('TechNoticesService.onMyWay', () => {
  it('renders onMyWayMsg for the client, the caller as the technician, and sends it to the job conversation', async () => {
    const { service, renderer, send, conversation } = makeService();
    const message = await service.onMyWay({ dealId: 'd1', etaMinutes: 15 }, techCaller);

    expect(send.conversationForContact).toHaveBeenCalledWith('ct1');
    expect(renderer.render).toHaveBeenCalledWith(
      { body: ON_MY_WAY, format: 'text' },
      { conversationId: 'c-client', contactId: 'ct1', dealId: 'd1', userId: TECH.id, values: { eta_minutes: '15' } },
    );
    expect(send.sendSystem).toHaveBeenCalledWith({
      conversation,
      body: `${ON_MY_WAY} [{"eta_minutes":"15"}]`,
      dealId: 'd1',
      origin: 'automation',
      automationRuleId: 'on-my-way',
      sentByUserId: TECH.id,
      clientMessageId: `automation:on-my-way:d1:${TECH.id}:${Math.floor(Date.now() / TECH_NOTICE_DEDUP_WINDOW_MS)}`,
      actorId: TECH.id,
    });
    expect(message.id).toBe('m-notice');
  });

  it('honours a caller-supplied clientMessageId', async () => {
    const { service, send } = makeService();
    await service.onMyWay({ dealId: 'd1', clientMessageId: UUID }, techCaller);
    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: UUID }));
  });

  it('404s an unknown job and 403s a caller who is not on the roster (even an admin)', async () => {
    await expect(makeService({ deal: null }).service.onMyWay({ dealId: 'nope' }, techCaller)).rejects.toMatchObject({ status: 404 });
    const { service, send } = makeService();
    await expect(service.onMyWay({ dealId: 'd1' }, { user: ADMIN, perms: adminPerms() })).rejects.toMatchObject({ status: 403 });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('answers 422 AUTOMATION_DISABLED when the rule or the onMyWayMsgNotify flag is off', async () => {
    const rule = await makeService({ rules: { 'on-my-way': false } }).service.onMyWay({ dealId: 'd1' }, techCaller).catch((e) => e);
    expect(rule).toBeInstanceOf(AutomationDisabledException);
    expect(rule.getStatus()).toBe(422);
    const flag = await makeService({ settings: { onMyWayMsgNotify: false } }).service.onMyWay({ dealId: 'd1' }, techCaller).catch((e) => e);
    expect(flag).toBeInstanceOf(AutomationDisabledException);
    // an unset flag means "on", as in Workiz
    await expect(makeService({ settings: { onMyWayMsgNotify: undefined } }).service.onMyWay({ dealId: 'd1' }, techCaller)).resolves.toBeDefined();
  });

  it('answers 422 without a configured text or a client contact', async () => {
    await expect(makeService({ settings: { onMyWayMsg: '' } }).service.onMyWay({ dealId: 'd1' }, techCaller)).rejects.toMatchObject({ status: 422 });
    await expect(
      makeService({ deal: { id: 'd1', assignedTechIds: [TECH.id] } }).service.onMyWay({ dealId: 'd1' }, techCaller),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('surfaces an opted-out client as 422 RECIPIENT_OPTED_OUT', async () => {
    const err = await makeService({ optedOut: true }).service.onMyWay({ dealId: 'd1' }, techCaller).catch((e) => e);
    expect(err).toBeInstanceOf(RecipientOptedOutException);
  });
});

describe('TechNoticesService.late', () => {
  it('renders lateMsg with late_value = minutes', async () => {
    const { service, renderer, send } = makeService();
    await service.late({ dealId: 'd1', minutes: 20 }, techCaller);
    expect(renderer.render).toHaveBeenCalledWith({ body: LATE, format: 'text' }, expect.objectContaining({ values: { late_value: '20' } }));
    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ automationRuleId: 'late', body: `${LATE} [{"late_value":"20"}]` }));
  });

  it('is gated by lateMsgNotify', async () => {
    await expect(makeService({ settings: { lateMsgNotify: false } }).service.late({ dealId: 'd1', minutes: 5 }, techCaller)).rejects.toBeInstanceOf(AutomationDisabledException);
  });
});
