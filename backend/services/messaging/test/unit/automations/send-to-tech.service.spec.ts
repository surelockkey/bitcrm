import { NotImplementedException } from '@nestjs/common';
import { type DealSentToTechEvent, type MessagingSettings } from '@bitcrm/types';
import { AUTOMATIONS_ACTOR } from '../../../src/automations/automations.constants';
import { type AutoSentMarker } from '../../../src/automations/auto-sent.repository';
import { type AutomationDeal, type AutomationUser, type SentToTechReport } from '../../../src/automations/internal/peers.client';
import { SendToTechService, sendToTechMessageKey, sendToTechRuleId } from '../../../src/automations/send-to-tech.service';
import { RecipientOptedOutException } from '../../../src/outbound/send.service';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

const SMS_FORMAT = 'New job #{{job_id}}\n{{full_name}}\n{{full_address}}\n{{job_type}}';
const SENT_AT = '2026-09-16T10:00:00.000Z';

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
  email: 'ann@example.com',
  status: 'active',
  ...overrides,
});

const event = (overrides: Partial<DealSentToTechEvent> = {}): DealSentToTechEvent => ({
  dealId: 'd1',
  dealNumber: '1001',
  techIds: ['t1'],
  channels: ['sms'],
  sentAt: SENT_AT,
  sentBy: 'disp-1',
  ...overrides,
});

function makeService(opts: {
  settings?: Partial<MessagingSettings>;
  deal?: AutomationDeal | null;
  users?: Record<string, AutomationUser | null>;
  markers?: Record<string, AutoSentMarker>;
  send?: { duplicate?: boolean; error?: Error; errorOn?: string };
  rendered?: string;
  report?: boolean;
} = {}) {
  const settings = { get: jest.fn(async () => ({ smsFormat: SMS_FORMAT, timezone: 'America/New_York', ...(opts.settings ?? {}) })) };
  const reports: SentToTechReport[] = [];
  const peers = {
    deal: jest.fn(async () => (opts.deal === undefined ? deal() : opts.deal)),
    user: jest.fn(async (id: string) => (opts.users ? opts.users[id] ?? null : user({ id }))),
    reportSentToTech: jest.fn(async (_dealId: string, report: SentToTechReport) => {
      reports.push(report);
      return opts.report ?? true;
    }),
  };
  const threads = {
    forTechnician: jest.fn(async (u: AutomationUser) =>
      createMockConversation({
        id: `c-${u.id}`,
        kind: 'team',
        partyKind: 'user',
        partyId: u.id,
        addresses: { phones: u.phone ? [u.phone] : [], emails: [] },
      }),
    ),
  };
  const renderer = { render: jest.fn(async () => ({ body: opts.rendered ?? 'New job #1001\nJohn Doe', missing: [] })) };
  const send = {
    sendSystem: jest.fn(async (input: { conversation: { id: string }; channel?: string }) => {
      if (opts.send?.error && (!opts.send.errorOn || opts.send.errorOn === (input.channel ?? 'sms'))) throw opts.send.error;
      return {
        duplicate: opts.send?.duplicate ?? false,
        message: createMockMessage({ id: `m-${input.channel ?? 'sms'}`, conversationId: input.conversation.id, direction: 'outbound', createdAt: T1 }),
      };
    }),
  };
  const stored = new Map(Object.entries(opts.markers ?? {}));
  const markers = {
    get: jest.fn(async (dealId: string, ruleId: string, techId: string) => stored.get(`${dealId}|${ruleId}|${techId}`) ?? null),
    put: jest.fn(async (m: AutoSentMarker) => { stored.set(`${m.dealId}|${m.ruleId}|${m.techId}`, m); }),
  };
  const service = new SendToTechService(settings as any, peers as any, threads as any, renderer as any, send as any, markers as any);
  return { service, settings, peers, threads, renderer, send, markers, stored, reports };
}

const marker = (channel: 'sms' | 'email' | 'in_app', sentFor: string): AutoSentMarker => ({
  dealId: 'd1',
  ruleId: sendToTechRuleId(channel),
  techId: 't1',
  scheduledDate: '2026-09-20',
  sentFor,
  conversationId: 'c-t1',
  messageId: `m-old-${channel}`,
  sentAt: T1,
});

describe('SendToTechService — deal.sent_to_tech', () => {
  it('renders smsFormat once and texts the technician in their team thread, keyed by the click', async () => {
    const { service, renderer, threads, send, markers, reports } = makeService();
    expect(await service.onSentToTech(event())).toEqual({ t1: { sms: 'sent' } });

    expect(renderer.render).toHaveBeenCalledWith({ body: SMS_FORMAT, format: 'text' }, { dealId: 'd1', userId: 't1' });
    expect(threads.forTechnician).toHaveBeenCalledTimes(1);
    expect(send.sendSystem).toHaveBeenCalledWith({
      conversation: expect.objectContaining({ kind: 'team', partyId: 't1' }),
      channel: 'sms',
      body: 'New job #1001\nJohn Doe',
      to: '+14045550001',
      dealId: 'd1',
      origin: 'automation',
      automationRuleId: 'send-to-tech:sms',
      sentByUserId: 'disp-1',
      clientMessageId: `send-to-tech:d1:t1:sms:${SENT_AT}`,
      actorId: AUTOMATIONS_ACTOR,
    });
    expect(markers.put).toHaveBeenCalledWith({
      dealId: 'd1',
      ruleId: 'send-to-tech:sms',
      techId: 't1',
      scheduledDate: '2026-09-20',
      sentFor: SENT_AT,
      conversationId: 'c-t1',
      messageId: 'm-sms',
      sentAt: T1,
    });
    expect(reports).toEqual([
      { techId: 't1', channel: 'sms', status: 'sent', sentAt: SENT_AT, messageId: 'm-sms', conversationId: 'c-t1', at: expect.any(String) },
    ]);
  });

  it('delivers every ticked channel to every technician, rendering the text once per technician', async () => {
    const { service, send, renderer, reports } = makeService();
    const outcomes = await service.onSentToTech(event({ techIds: ['t1', 't2'], channels: ['sms', 'in_app', 'email'] }));

    expect(outcomes).toEqual({
      t1: { sms: 'sent', in_app: 'sent', email: 'sent' },
      t2: { sms: 'sent', in_app: 'sent', email: 'sent' },
    });
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(send.sendSystem).toHaveBeenCalledTimes(6);
    expect(reports).toHaveLength(6);
    expect(reports.every((r) => r.status === 'sent')).toBe(true);
  });

  it('mails the technician with a "New job #…" subject and posts in-app without a phone', async () => {
    const { service, send } = makeService({ users: { t1: user({ phone: undefined }) } });
    expect(await service.onSentToTech(event({ channels: ['in_app', 'email'] }))).toEqual({ t1: { in_app: 'sent', email: 'sent' } });

    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ channel: 'in_app', automationRuleId: 'send-to-tech:in_app' }));
    expect(send.sendSystem).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', to: 'ann@example.com', subject: 'New job #1001', automationRuleId: 'send-to-tech:email' }),
    );
    // No `to` is passed on an in-app line: there is no address to send to.
    expect(send.sendSystem.mock.calls.find((c: any[]) => c[0].channel === 'in_app')?.[0]).not.toHaveProperty('to');
  });

  it('is idempotent per click: a redelivery sends nothing, a second press (new sentAt) sends again', async () => {
    const replay = makeService({ markers: { [`d1|send-to-tech:sms|t1`]: marker('sms', SENT_AT) } });
    expect(await replay.service.onSentToTech(event())).toEqual({ t1: { sms: 'duplicate' } });
    expect(replay.send.sendSystem).not.toHaveBeenCalled();
    // The stamp is still reported so a lost first report is healed.
    expect(replay.reports).toEqual([
      { techId: 't1', channel: 'sms', status: 'sent', sentAt: SENT_AT, messageId: 'm-old-sms', conversationId: 'c-t1', at: expect.any(String) },
    ]);

    const resend = makeService({ markers: { [`d1|send-to-tech:sms|t1`]: marker('sms', '2026-09-16T09:00:00.000Z') } });
    expect(await resend.service.onSentToTech(event())).toEqual({ t1: { sms: 'sent' } });
    expect(resend.send.sendSystem).toHaveBeenCalledTimes(1);
  });

  it('keeps one channel\'s marker from silencing another', async () => {
    const { service, send } = makeService({ markers: { [`d1|send-to-tech:sms|t1`]: marker('sms', SENT_AT) } });
    expect(await service.onSentToTech(event({ channels: ['sms', 'email'] }))).toEqual({ t1: { sms: 'duplicate', email: 'sent' } });
    expect(send.sendSystem).toHaveBeenCalledTimes(1);
  });

  it('records the CLIENTMSG# guard\'s duplicate as delivered', async () => {
    const { service, markers, reports } = makeService({ send: { duplicate: true } });
    expect(await service.onSentToTech(event())).toEqual({ t1: { sms: 'duplicate' } });
    expect(markers.put).toHaveBeenCalledTimes(1);
    expect(reports[0]).toMatchObject({ status: 'sent' });
  });

  it('skips and reports a reason per channel: no phone, no email, email not configured, opted out', async () => {
    const noPhone = makeService({ users: { t1: user({ phone: undefined }) } });
    expect(await noPhone.service.onSentToTech(event())).toEqual({ t1: { sms: 'no_phone' } });
    expect(noPhone.reports[0]).toMatchObject({ status: 'skipped', reason: 'no_phone', sentAt: SENT_AT });
    expect(noPhone.send.sendSystem).not.toHaveBeenCalled();

    const noEmail = makeService({ users: { t1: user({ email: undefined }) } });
    expect(await noEmail.service.onSentToTech(event({ channels: ['email'] }))).toEqual({ t1: { email: 'no_email' } });
    expect(noEmail.reports[0]).toMatchObject({ status: 'skipped', reason: 'no_email' });

    const notConfigured = makeService({ send: { error: new NotImplementedException('Email sending is not configured (MESSAGING_EMAIL_FROM)') } });
    expect(await notConfigured.service.onSentToTech(event({ channels: ['email'] }))).toEqual({ t1: { email: 'email_not_configured' } });
    expect(notConfigured.reports[0]).toMatchObject({ status: 'skipped', reason: 'email_not_configured' });
    expect(notConfigured.markers.put).not.toHaveBeenCalled();

    const optedOut = makeService({ send: { error: new RecipientOptedOutException('+14045550001') } });
    expect(await optedOut.service.onSentToTech(event())).toEqual({ t1: { sms: 'opted_out' } });
    expect(optedOut.reports[0]).toMatchObject({ status: 'skipped', reason: 'opted_out' });
    expect(optedOut.markers.put).not.toHaveBeenCalled();
  });

  it('delivers the other channels when one is skipped', async () => {
    const { service } = makeService({ send: { error: new RecipientOptedOutException('+14045550001'), errorOn: 'sms' } });
    expect(await service.onSentToTech(event({ channels: ['sms', 'in_app'] }))).toEqual({ t1: { sms: 'opted_out', in_app: 'sent' } });
  });

  it('re-reads the roster: a technician taken off the job since the click, an unknown or inactive one is skipped', async () => {
    const { service, reports } = makeService({
      deal: deal({ assignedTechIds: ['t1', 't3'] }),
      users: { t1: user(), t3: user({ id: 't3', status: 'inactive' }), t4: null },
    });
    expect(await service.onSentToTech(event({ techIds: ['t1', 't2', 't3', 't4'], channels: ['sms', 'in_app'] }))).toEqual({
      t1: { sms: 'sent', in_app: 'sent' },
      t2: { sms: 'not_on_roster', in_app: 'not_on_roster' },
      t3: { sms: 'inactive_user', in_app: 'inactive_user' },
      t4: { sms: 'not_on_roster', in_app: 'not_on_roster' },
    });
    // Both channels of a skipped technician are reported, so the job page can explain each.
    expect(reports.filter((r) => r.techId === 't2')).toHaveLength(2);
  });

  it('reports "no user" for a technician on the roster that user-service does not know', async () => {
    const { service } = makeService({ deal: deal({ assignedTechIds: ['t1'] }), users: { t1: null } });
    expect(await service.onSentToTech(event())).toEqual({ t1: { sms: 'no_user' } });
  });

  it('skips a text that rendered empty', async () => {
    const { service, send, reports } = makeService({ rendered: '   ' });
    expect(await service.onSentToTech(event())).toEqual({ t1: { sms: 'blank_text' } });
    expect(send.sendSystem).not.toHaveBeenCalled();
    expect(reports[0]).toMatchObject({ reason: 'blank_text' });
  });

  it('is not held by quiet hours — a dispatcher asked for it now', async () => {
    const { service, send } = makeService({ settings: { quietHours: { from: '00:00', to: '23:59', timezone: 'America/New_York' } } });
    expect(await service.onSentToTech(event())).toEqual({ t1: { sms: 'sent' } });
    expect(send.sendSystem).toHaveBeenCalledTimes(1);
  });

  it('without a template, reports every (technician, channel) as skipped and reads no job', async () => {
    const { service, peers, reports } = makeService({ settings: { smsFormat: '  ' } });
    expect(await service.onSentToTech(event({ techIds: ['t1', 't2'], channels: ['sms', 'email'] }))).toBe('no_template');
    expect(peers.deal).not.toHaveBeenCalled();
    expect(reports).toHaveLength(4);
    expect(reports.every((r) => r.status === 'skipped' && r.reason === 'no_template')).toBe(true);
  });

  it('gives up quietly when the job is not readable', async () => {
    const { service, send, reports } = makeService({ deal: null });
    expect(await service.onSentToTech(event())).toBe('no_deal');
    expect(send.sendSystem).not.toHaveBeenCalled();
    expect(reports).toHaveLength(0);
  });

  it('drops a malformed payload without touching the settings', async () => {
    const { service, settings } = makeService();
    expect(await service.onSentToTech({ dealId: 'd1', techIds: [], channels: ['sms'], sentAt: SENT_AT })).toBe('malformed');
    expect(await service.onSentToTech({ dealId: 'd1', techIds: ['t1'], channels: ['carrier-pigeon'], sentAt: SENT_AT })).toBe('malformed');
    expect(await service.onSentToTech(null)).toBe('malformed');
    expect(settings.get).not.toHaveBeenCalled();
  });

  it('lets an unexpected error propagate so SQS retries onto the markers of what already went', async () => {
    const { service } = makeService({ send: { error: new Error('ProvisionedThroughputExceeded') } });
    await expect(service.onSentToTech(event())).rejects.toThrow('ProvisionedThroughputExceeded');
  });

  it('carries on when deal-service will not take the delivery report', async () => {
    const { service, markers } = makeService({ report: false });
    expect(await service.onSentToTech(event())).toEqual({ t1: { sms: 'sent' } });
    expect(markers.put).toHaveBeenCalledTimes(1);
  });

  it('titles the mail without a number when the job has none', async () => {
    const { service, send } = makeService({ deal: deal({ dealNumber: undefined }) });
    await service.onSentToTech(event({ dealNumber: undefined, channels: ['email'] }));
    expect(send.sendSystem).toHaveBeenCalledWith(expect.objectContaining({ subject: 'New job' }));
  });
});

describe('send-to-tech keys', () => {
  it('names one AUTOSENT# rule and one CLIENTMSG# key per (job, technician, channel, click)', () => {
    expect(sendToTechRuleId('in_app')).toBe('send-to-tech:in_app');
    expect(sendToTechMessageKey('d1', 't1', 'email', SENT_AT)).toBe(`send-to-tech:d1:t1:email:${SENT_AT}`);
  });
});
