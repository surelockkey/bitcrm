import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { type ConversationSendOptions, type ResolvedPermissions, type SendableMessageChannel } from '@bitcrm/types';
import { SendService } from '../../../src/outbound/send.service';
import { createMockConversation } from '../mocks';

const user = { id: 'u1', cognitoSub: 's', email: 'u1@x.co', roleId: 'r1', department: 'ops' };

function perms(overrides: { messages?: Record<string, boolean>; teamChat?: Record<string, boolean>; viewNumbers?: boolean } = {}): ResolvedPermissions {
  return {
    roleId: 'r1',
    roleName: 'Dispatcher',
    isSystemRole: false,
    permissions: {
      messages: overrides.messages ?? { view: true, send: true, manage: true },
      team_chat: overrides.teamChat ?? { view: true, send: true, manage_groups: false },
      contacts: { view: true, view_numbers: overrides.viewNumbers ?? true },
    } as never,
    dataScope: { messages: 'all', team_chat: 'all' } as never,
    dealStageTransitions: [],
    hasOverrides: false,
  };
}

function makeService(opts: {
  conversation?: ReturnType<typeof createMockConversation> | null;
  optedOut?: (channel: string, address: string) => boolean;
  sender?: { from?: string; source: string } | Error;
  /** `null` = no such user; `'unreachable'` = the directory throws; `'none'` = no directory wired. */
  teammate?: { id: string; name: string; phone?: string } | null | 'unreachable' | 'none';
  email?: { configured: boolean; resolve: jest.Mock } | 'none';
} = {}) {
  const conversation = opts.conversation === undefined ? createMockConversation() : opts.conversation;
  const conversations = { get: jest.fn(async () => conversation) };
  const messages = {};
  const optOuts = {
    isOptedOut: jest.fn(async (channel: string, address: string) => opts.optedOut?.(channel, address) ?? false),
  };
  const sender = {
    resolve: jest.fn(async () => {
      if (opts.sender instanceof Error) throw opts.sender;
      return opts.sender ?? { from: '+15550001111', source: 'sticky' };
    }),
  };
  const teammate = opts.teammate === undefined ? { id: 'u2', name: 'Ann Tech', phone: '+14045550002' } : opts.teammate;
  const users =
    teammate === 'none'
      ? undefined
      : {
          find: jest.fn(async (id: string) => {
            if (teammate === 'unreachable') throw new ServiceUnavailableException('User service unreachable');
            return teammate ? { ...teammate, id } : null;
          }),
        };
  const email =
    opts.email === 'none'
      ? undefined
      : (opts.email ?? {
          configured: true,
          resolve: jest.fn(async () => ({ from: 'office@surelock.test', fromHeader: 'Sure Lock <office@surelock.test>' })),
        });
  const service = new SendService(
    conversations as any, messages as any, optOuts as any, sender as any, {} as any, { find: jest.fn(async () => null) } as any,
    {} as any, {} as any, undefined, undefined, users as any, undefined, email as any,
  );
  return { service, conversations, optOuts, sender, users, email };
}

/** The option for one channel, by name — the order is part of what is asserted elsewhere. */
const of = (options: ConversationSendOptions, channel: SendableMessageChannel) =>
  options.channels.find((c) => c.channel === channel)!;

const clientThread = () => createMockConversation({ addresses: { phones: ['+14045551234'], emails: ['jane@example.com'] } });

const teamThread = () =>
  createMockConversation({ id: 'c-team', kind: 'team', partyKind: 'user', partyId: 'u2', addresses: { phones: [], emails: [] } });

describe('SendService.sendOptions', () => {
  it('answers a client thread with the number it would text, the address it would mail, and in-app refused', async () => {
    const { service } = makeService({ conversation: clientThread() });
    const options = await service.sendOptions('c1', { user, perms: perms() });

    expect(options.conversationId).toBe('c1');
    expect(options.defaultChannel).toBe('sms');
    // A client leads with the text; the app they do not have comes last.
    expect(options.channels.map((c) => c.channel)).toEqual(['sms', 'email', 'in_app']);
    expect(of(options, 'sms')).toMatchObject({
      available: true,
      to: '+14045551234',
      from: '+15550001111',
      fromSource: 'sticky',
    });
    expect(of(options, 'email')).toMatchObject({ available: true, to: 'jane@example.com', from: 'office@surelock.test' });
    expect(of(options, 'in_app')).toEqual({ channel: 'in_app', available: false, reason: 'not_a_team_thread' });
  });

  it('names the missing address instead of letting the send discover it', async () => {
    const { service } = makeService({
      conversation: createMockConversation({ addresses: { phones: [], emails: [] } }),
    });
    const options = await service.sendOptions('c1', { user, perms: perms() });

    expect(of(options, 'sms')).toEqual({ channel: 'sms', available: false, reason: 'no_phone' });
    expect(of(options, 'email')).toEqual({ channel: 'email', available: false, reason: 'no_email' });
    // Nothing can go out of this thread at all.
    expect(options.defaultChannel).toBeUndefined();
  });

  it('reports both opt-out ledgers, keeping the address that refused so the reader knows which', async () => {
    const { service } = makeService({
      conversation: clientThread(),
      optedOut: () => true,
    });
    const options = await service.sendOptions('c1', { user, perms: perms() });

    expect(of(options, 'sms')).toMatchObject({ available: false, reason: 'opted_out_sms', to: '+14045551234' });
    expect(of(options, 'email')).toMatchObject({ available: false, reason: 'opted_out_email', to: 'jane@example.com' });
    expect(options.defaultChannel).toBeUndefined();
  });

  it('says email is not configured rather than offering a channel that answers 501', async () => {
    const { service } = makeService({ conversation: clientThread(), email: 'none' });
    const options = await service.sendOptions('c1', { user, perms: perms() });
    expect(of(options, 'email')).toEqual({ channel: 'email', available: false, reason: 'email_not_configured' });
    expect(options.defaultChannel).toBe('sms');
  });

  it('withholds the digits from a viewer without contacts.view_numbers, but still lets them send', async () => {
    const { service } = makeService({ conversation: clientThread() });
    const options = await service.sendOptions('c1', { user, perms: perms({ viewNumbers: false }) });

    const sms = of(options, 'sms');
    expect(sms).toMatchObject({ available: true, toMasked: true });
    expect(sms.to).toBeUndefined();
    // The workspace's own number is not a client number and is never masked.
    expect(sms.from).toBe('+15550001111');
  });

  it("leads a teammate's thread with in-app and texts their personal phone, not the thread's", async () => {
    const { service, sender } = makeService({ conversation: teamThread() });
    const options = await service.sendOptions('c-team', { user, perms: perms() });

    expect(options.channels.map((c) => c.channel)).toEqual(['in_app', 'sms', 'email']);
    expect(options.defaultChannel).toBe('in_app');
    expect(of(options, 'in_app')).toMatchObject({ available: true, toName: 'Ann Tech' });
    expect(of(options, 'sms')).toMatchObject({ available: true, to: '+14045550002', toName: 'Ann Tech' });
    // A teammate is texted from the workspace number, never a job's line (design §6).
    expect(sender.resolve).toHaveBeenCalledWith(expect.objectContaining({ dealId: undefined }));
  });

  it('tells the dispatcher a teammate has no number on file, and when the directory could not be asked', async () => {
    const noPhone = makeService({ conversation: teamThread(), teammate: { id: 'u2', name: 'Ann Tech' } });
    expect(of(await noPhone.service.sendOptions('c-team', { user, perms: perms() }), 'sms')).toEqual({
      channel: 'sms',
      available: false,
      reason: 'employee_has_no_phone',
    });

    const down = makeService({ conversation: teamThread(), teammate: 'unreachable' });
    const options = await down.service.sendOptions('c-team', { user, perms: perms() });
    expect(of(options, 'sms')).toEqual({ channel: 'sms', available: false, reason: 'employee_unknown' });
    // The thread still has its in-app line: one lookup failing costs one channel.
    expect(of(options, 'in_app').available).toBe(true);
    expect(options.defaultChannel).toBe('in_app');
  });

  it('offers a group its in-app line by name, with nothing to text or mail', async () => {
    const { service } = makeService({
      conversation: createMockConversation({
        id: 'c-grp',
        kind: 'group',
        partyKind: 'group',
        partyId: 'g1',
        name: 'Dispatch',
        memberIds: ['u1', 'u2'],
        addresses: { phones: [], emails: [] },
      }),
    });
    const options = await service.sendOptions('c-grp', { user, perms: perms() });

    expect(of(options, 'in_app')).toEqual({ channel: 'in_app', available: true, toName: 'Dispatch' });
    expect(of(options, 'sms').reason).toBe('no_phone');
    expect(options.defaultChannel).toBe('in_app');
  });

  it('keeps the channel when the sender chain cannot be reached — the send stays the authority', async () => {
    const { service } = makeService({ conversation: clientThread(), sender: new Error('telephony down') });
    const sms = of(await service.sendOptions('c1', { user, perms: perms() }), 'sms');
    expect(sms).toMatchObject({ available: true, to: '+14045551234' });
    expect(sms.from).toBeUndefined();
  });

  it('is gated exactly like the send it describes: 404 for no thread, 403 without team_chat.send', async () => {
    const missing = makeService({ conversation: null });
    await expect(missing.service.sendOptions('nope', { user, perms: perms() })).rejects.toBeInstanceOf(NotFoundException);

    const team = makeService({ conversation: teamThread() });
    await expect(
      team.service.sendOptions('c-team', { user, perms: perms({ teamChat: { view: true, send: false } }) }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
