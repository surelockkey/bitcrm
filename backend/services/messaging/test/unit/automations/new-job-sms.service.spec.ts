import { type MessagingSettings } from '@bitcrm/types';
import { AUTOMATIONS_ACTOR } from '../../../src/automations/automations.constants';
import { type AutoSentMarker } from '../../../src/automations/auto-sent.repository';
import { type AutomationDeal, type AutomationUser } from '../../../src/automations/internal/peers.client';
import { NEW_JOB_SMS_RULE_ID, NewJobSmsService } from '../../../src/automations/new-job-sms.service';
import { RecipientOptedOutException } from '../../../src/outbound/send.service';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

const SMS_FORMAT = 'New job #{{job_id}}\n{{full_name}}\n{{full_address}}\n{{job_type}}\nNotes: {{description}}';

const deal = (overrides: Partial<AutomationDeal> = {}): AutomationDeal => ({
  id: 'd1',
  dealNumber: '1001',
  contactId: 'ct1',
  scheduledDate: '2026-09-20',
  assignedTechIds: ['t1', 't2'],
  superStatus: 'in_progress',
  ...overrides,
});

const user = (overrides: Partial<AutomationUser> = {}): AutomationUser => ({
  id: 't1',
  firstName: 'Ann',
  lastName: 'Lee',
  phone: '+14045550001',
  status: 'active',
  ...overrides,
});

function makeService(opts: {
  enabled?: boolean;
  settings?: Partial<MessagingSettings>;
  deal?: AutomationDeal | null;
  users?: Record<string, AutomationUser | null>;
  markers?: Record<string, AutoSentMarker>;
  send?: { duplicate?: boolean; error?: Error };
  rendered?: string;
} = {}) {
  const rules = { isEnabled: jest.fn(async () => opts.enabled ?? true) };
  const settings = { get: jest.fn(async () => ({ smsFormat: SMS_FORMAT, timezone: 'America/New_York', ...(opts.settings ?? {}) })) };
  const peers = {
    deal: jest.fn(async () => (opts.deal === undefined ? deal() : opts.deal)),
    user: jest.fn(async (id: string) => (opts.users ? opts.users[id] ?? null : user({ id, phone: `+1404555000${id.slice(-1)}` }))),
  };
  const thread = createMockConversation({ id: 'c-team', kind: 'team', partyKind: 'user', partyId: 't1', addresses: { phones: ['+14045550001'], emails: [] } });
  const threads = { forTechnician: jest.fn(async (u: AutomationUser) => ({ ...thread, partyId: u.id, addresses: { phones: [u.phone!], emails: [] } })) };
  const renderer = { render: jest.fn(async () => ({ body: opts.rendered ?? 'New job #1001\nJohn Doe', missing: [] })) };
  const send = {
    sendSystem: jest.fn(async (input: { conversation: { id: string } }) => {
      if (opts.send?.error) throw opts.send.error;
      return {
        duplicate: opts.send?.duplicate ?? false,
        message: createMockMessage({ id: 'm-new', conversationId: input.conversation.id, direction: 'outbound', status: 'queued', createdAt: T1 }),
      };
    }),
  };
  const stored = new Map(Object.entries(opts.markers ?? {}));
  const markers = {
    get: jest.fn(async (dealId: string, ruleId: string, techId: string) => stored.get(`${dealId}|${ruleId}|${techId}`) ?? null),
    put: jest.fn(async (m: AutoSentMarker) => { stored.set(`${m.dealId}|${m.ruleId}|${m.techId}`, m); }),
  };
  const service = new NewJobSmsService(rules as any, settings as any, peers as any, threads as any, renderer as any, send as any, markers as any);
  return { service, rules, settings, peers, threads, renderer, send, markers, stored };
}

const marker = (techId: string, scheduledDate: string): AutoSentMarker => ({
  dealId: 'd1', ruleId: NEW_JOB_SMS_RULE_ID, techId, scheduledDate, conversationId: 'c-team', messageId: 'm-old', sentAt: T1,
});

describe('NewJobSmsService — deal.tech_assigned', () => {
  it('renders smsFormat for the job + technician and texts their personal phone in their team thread, then writes the marker', async () => {
    const { service, renderer, threads, send, markers } = makeService();
    expect(await service.notify('d1', ['t1'], 'assigned')).toEqual({ t1: 'sent' });

    expect(renderer.render).toHaveBeenCalledWith({ body: SMS_FORMAT, format: 'text' }, { dealId: 'd1', userId: 't1' });
    expect(threads.forTechnician).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', phone: '+14045550001' }));
    expect(send.sendSystem).toHaveBeenCalledWith({
      conversation: expect.objectContaining({ kind: 'team', partyId: 't1' }),
      body: 'New job #1001\nJohn Doe',
      to: '+14045550001',
      dealId: 'd1',
      origin: 'automation',
      automationRuleId: 'new-job-sms',
      clientMessageId: 'automation:new-job-sms:d1:t1:2026-09-20',
      actorId: AUTOMATIONS_ACTOR,
    });
    expect(markers.put).toHaveBeenCalledWith({
      dealId: 'd1', ruleId: 'new-job-sms', techId: 't1', scheduledDate: '2026-09-20', conversationId: 'c-team', messageId: 'm-new', sentAt: T1,
    });
  });

  it('goes through the SQS entry point and drops a malformed payload', async () => {
    const { service, send, peers } = makeService();
    await service.onTechAssigned({ dealId: 'd1', techId: 't2', assignedBy: 'disp-1' });
    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ to: '+14045550002', clientMessageId: 'automation:new-job-sms:d1:t2:2026-09-20' }));
    await service.onTechAssigned({ dealId: 'd1' });
    expect(peers.deal).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the rule is disabled or smsFormat is empty', async () => {
    const off = makeService({ enabled: false });
    expect(await off.service.notify('d1', ['t1'], 'assigned')).toBe('disabled');
    expect(off.settings.get).not.toHaveBeenCalled();

    const blank = makeService({ settings: { smsFormat: '  ' } });
    expect(await blank.service.notify('d1', ['t1'], 'assigned')).toBe('no_template');
    expect(blank.peers.deal).not.toHaveBeenCalled();
  });

  it('skips an unreadable or closed job', async () => {
    expect(await makeService({ deal: null }).service.notify('d1', ['t1'], 'assigned')).toBe('no_deal');
    expect(await makeService({ deal: deal({ superStatus: 'canceled' }) }).service.notify('d1', ['t1'], 'assigned')).toBe('closed_deal');
  });

  it('holds the text during quiet hours without writing a marker', async () => {
    const { service, send, markers } = makeService({ settings: { quietHours: { from: '00:00', to: '23:59', timezone: 'America/New_York' } } });
    expect(await service.notify('d1', ['t1'], 'assigned')).toBe('quiet_hours');
    expect(send.sendSystem).not.toHaveBeenCalled();
    expect(markers.put).not.toHaveBeenCalled();
  });

  it('sends once per (job, technician, date): a replay is already_notified', async () => {
    const { service, send } = makeService({ markers: { 'd1|new-job-sms|t1': marker('t1', '2026-09-20') } });
    expect(await service.notify('d1', ['t1'], 'assigned')).toEqual({ t1: 'already_notified' });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('records the marker even when the CLIENTMSG# guard says the send already happened', async () => {
    const { service, markers } = makeService({ send: { duplicate: true } });
    expect(await service.notify('d1', ['t1'], 'assigned')).toEqual({ t1: 'duplicate' });
    expect(markers.put).toHaveBeenCalledTimes(1);
  });

  it('skips a technician no longer on the roster, without a phone, or inactive', async () => {
    const { service, send } = makeService({
      deal: deal({ assignedTechIds: ['t1', 't3', 't4'] }),
      users: { t1: user({ phone: undefined }), t3: user({ id: 't3', status: 'inactive' }), t4: null },
    });
    expect(await service.notify('d1', ['t1', 't2', 't3', 't4'], 'assigned')).toEqual({
      t1: 'no_phone', t2: 'not_on_roster', t3: 'inactive_user', t4: 'no_phone',
    });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('skips an opted-out technician and leaves no marker, so an opt-in + reschedule can reach them', async () => {
    const { service, markers } = makeService({ send: { error: new RecipientOptedOutException('+14045550001') } });
    expect(await service.notify('d1', ['t1'], 'assigned')).toEqual({ t1: 'opted_out' });
    expect(markers.put).not.toHaveBeenCalled();
  });

  it('lets a table error propagate so SQS retries', async () => {
    const { service } = makeService({ send: { error: new Error('ProvisionedThroughputExceeded') } });
    await expect(service.notify('d1', ['t1'], 'assigned')).rejects.toThrow('ProvisionedThroughputExceeded');
  });

  it('skips a text that rendered empty', async () => {
    const { service, send } = makeService({ rendered: '   ' });
    expect(await service.notify('d1', ['t1'], 'assigned')).toEqual({ t1: 'blank_text' });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('keys an unscheduled job as such', async () => {
    const { service, send } = makeService({ deal: deal({ scheduledDate: undefined }) });
    await service.notify('d1', ['t1'], 'assigned');
    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId: 'automation:new-job-sms:d1:t1:unscheduled' }));
  });
});

describe('NewJobSmsService — deal.updated (reschedule)', () => {
  it('re-texts only the technicians who were told a different date', async () => {
    const { service, send, markers } = makeService({
      markers: { 'd1|new-job-sms|t1': marker('t1', '2026-09-18'), 'd1|new-job-sms|t2': marker('t2', '2026-09-20') },
    });
    await service.onDealUpdated({ dealId: 'd1', updatedBy: 'disp-1' });
    expect(send.sendSystem).toHaveBeenCalledTimes(1);
    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ to: '+14045550001', clientMessageId: 'automation:new-job-sms:d1:t1:2026-09-20' }));
    expect(markers.put).toHaveBeenCalledWith(expect.objectContaining({ techId: 't1', scheduledDate: '2026-09-20' }));
  });

  it('ignores an edit that did not move the date, and technicians never told', async () => {
    const { service, send } = makeService({ markers: { 'd1|new-job-sms|t1': marker('t1', '2026-09-20') } });
    expect(await service.notify('d1', undefined, 'rescheduled')).toEqual({ t1: 'already_notified', t2: 'already_notified' });
    expect(send.sendSystem).not.toHaveBeenCalled();
  });

  it('drops a malformed deal.updated payload', async () => {
    const { service, rules } = makeService();
    await service.onDealUpdated({ updatedBy: 'x' });
    expect(rules.isEnabled).not.toHaveBeenCalled();
  });
});
