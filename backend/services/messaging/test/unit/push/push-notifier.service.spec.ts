import { type MessagingSettings, type PushDevice } from '@bitcrm/types';
import { type ExpoPushMessage } from '../../../src/push/expo-push.service';
import { PushNotifierService } from '../../../src/push/push-notifier.service';
import { createMockConversation, createMockMessage } from '../mocks';

const device = (token: string, userId = 'u1'): PushDevice => ({
  token,
  userId,
  platform: 'ios',
  registeredAt: '2026-09-01T00:00:00.000Z',
  lastSeenAt: '2026-09-17T00:00:00.000Z',
});

const JOB = {
  dealId: 'd1',
  techId: 't1',
  deal: { dealNumber: 'A3F9K2', scheduledDate: '2026-09-20', scheduledTimeSlot: '09:00-12:00' },
};

/** 20:00 → 08:00 America/New_York; 03:00 UTC is 23:00 there — inside it. */
const QUIET: MessagingSettings['quietHours'] = { from: '20:00', to: '08:00', timezone: 'America/New_York' };

function makeNotifier(
  opts: {
    enabled?: boolean;
    devices?: Record<string, PushDevice[]>;
    settings?: Partial<MessagingSettings>;
    optedOut?: string[];
    accepted?: number;
  } = {},
) {
  const batches: ExpoPushMessage[][] = [];
  const expo = {
    enabled: opts.enabled ?? true,
    send: jest.fn(async (messages: ExpoPushMessage[]) => {
      batches.push(messages);
      return {
        disabled: false,
        accepted: opts.accepted ?? messages.length,
        failed: 0,
        unregistered: [],
        pending: [],
      };
    }),
  };
  const devices = {
    listByUser: jest.fn(async (userId: string) => opts.devices?.[userId] ?? []),
    listByUsers: jest.fn(async (ids: string[]) => ids.flatMap((id) => opts.devices?.[id] ?? [])),
  };
  const settings = {
    get: jest.fn(async () => ({ timezone: 'America/New_York', ...(opts.settings ?? {}) }) as MessagingSettings),
  };
  const optOuts = {
    isOptedOut: jest.fn(async (_channel: string, address: string) => (opts.optedOut ?? []).includes(address)),
  };
  const service = new PushNotifierService(expo as any, devices as any, settings as any, optOuts as any);
  return { service, expo, devices, settings, optOuts, batches };
}

describe('PushNotifierService', () => {
  describe('a job was sent to the technician', () => {
    it('pushes the job number, when it is and where, with the job payload', async () => {
      const { service, batches } = makeNotifier({
        devices: { t1: [device('phone-a', 't1'), device('phone-b', 't1')] },
      });

      const sent = await service.notifyJobSentToTech({
        ...JOB,
        deal: { ...JOB.deal, address: { street: '128 Main St', city: 'Hartford', state: 'CT', zip: '06103' } },
      });

      expect(sent).toBe(2);
      expect(batches[0]).toEqual([
        {
          to: 'phone-a',
          title: 'New job #A3F9K2',
          body: 'Sep 20, 2026 · 9:00 AM–12:00 PM · 128 Main St, Hartford',
          data: { kind: 'job', dealId: 'd1' },
          sound: 'default',
          priority: 'high',
        },
        expect.objectContaining({ to: 'phone-b', data: { kind: 'job', dealId: 'd1' } }),
      ]);
    });

    it('does nothing when the technician carries no registered phone', async () => {
      const { service, expo } = makeNotifier({ devices: {} });
      expect(await service.notifyJobSentToTech(JOB)).toBe('no_device');
      expect(expo.send).not.toHaveBeenCalled();
    });

    it('goes out inside quiet hours — a dispatcher sending a job is asking for it now', async () => {
      // The same rule SendToTechService already applies to the SMS: quiet
      // hours hold background automations, not a person pressing a button.
      jest.useFakeTimers().setSystemTime(new Date('2026-09-18T03:00:00.000Z'));
      try {
        const { service, expo } = makeNotifier({
          devices: { t1: [device('phone-a', 't1')] },
          settings: { quietHours: QUIET },
        });
        expect(await service.notifyJobSentToTech(JOB)).toBe(1);
        expect(expo.send).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('never lets a failed push take down the delivery that produced it', async () => {
      const { service, devices } = makeNotifier({ devices: { t1: [device('phone-a', 't1')] } });
      devices.listByUser.mockRejectedValueOnce(new Error('table is throttling'));

      await expect(service.notifyJobSentToTech(JOB)).resolves.toBe('failed');
    });
  });

  describe('a new message the user should see', () => {
    const team = createMockConversation({
      id: 'c1',
      kind: 'team',
      partyKind: 'user',
      partyId: 'u1',
      addresses: { phones: ['+14045550001'], emails: [] },
    });
    const group = createMockConversation({ id: 'c2', kind: 'group', name: 'Dispatch', memberIds: ['u1', 'u2'] });
    const line = createMockMessage({
      id: 'm9',
      conversationId: 'c1',
      channel: 'in_app',
      direction: 'outbound',
      body: 'Can you take 128 Main?',
      sentByUserId: 'disp-1',
      sentByName: 'Ann Lee',
    });

    it('pushes the sender, the text and the conversation payload', async () => {
      const { service, batches } = makeNotifier({ devices: { u1: [device('phone-a')] } });

      expect(await service.notifyNewMessage(line, team, ['u1'])).toBe(1);
      expect(batches[0]).toEqual([
        {
          to: 'phone-a',
          title: 'Ann Lee',
          body: 'Can you take 128 Main?',
          data: { kind: 'conversation', conversationId: 'c1', messageId: 'm9' },
          sound: 'default',
          priority: 'high',
        },
      ]);
    });

    it('reaches every member of a group but the author', async () => {
      const { service, devices, batches } = makeNotifier({
        devices: { u1: [device('phone-a', 'u1')], u2: [device('phone-b', 'u2')] },
      });

      await service.notifyNewMessage({ ...line, conversationId: 'c2', sentByUserId: 'u2' }, group, ['u1', 'u2']);

      expect(devices.listByUsers).toHaveBeenCalledWith(['u1']);
      expect(batches[0].map((m) => m.to)).toEqual(['phone-a']);
    });

    it('never pushes someone their own message', async () => {
      const { service, expo } = makeNotifier({ devices: { 'disp-1': [device('phone-a', 'disp-1')] } });

      expect(await service.notifyNewMessage(line, team, ['disp-1'])).toBe('own_message');
      expect(expo.send).not.toHaveBeenCalled();
    });

    it('has nobody to push a client thread to — the office watches the inbox', async () => {
      const { service, expo } = makeNotifier();
      expect(await service.notifyNewMessage(line, createMockConversation(), [])).toBe('no_recipients');
      expect(expo.send).not.toHaveBeenCalled();
    });

    it('holds a chat line during quiet hours', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-18T03:00:00.000Z'));
      try {
        const { service, expo, devices } = makeNotifier({
          devices: { u1: [device('phone-a')] },
          settings: { quietHours: QUIET },
        });
        expect(await service.notifyNewMessage(line, team, ['u1'])).toBe('quiet_hours');
        expect(expo.send).not.toHaveBeenCalled();
        // Held before the registry is even read.
        expect(devices.listByUsers).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('goes out once quiet hours are over', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-18T17:00:00.000Z'));
      try {
        const { service, expo } = makeNotifier({
          devices: { u1: [device('phone-a')] },
          settings: { quietHours: QUIET },
        });
        expect(await service.notifyNewMessage(line, team, ['u1'])).toBe(1);
        expect(expo.send).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('respects a STOP on the number of the employee whose thread it is', async () => {
      const { service, expo, optOuts } = makeNotifier({
        devices: { u1: [device('phone-a')] },
        optedOut: ['+14045550001'],
      });

      expect(await service.notifyNewMessage(line, team, ['u1'])).toBe('opted_out');
      expect(optOuts.isOptedOut).toHaveBeenCalledWith('sms', '+14045550001');
      expect(expo.send).not.toHaveBeenCalled();
    });

    it('has no address to check on a group, so a STOP elsewhere does not silence it', async () => {
      const { service, optOuts } = makeNotifier({
        devices: { u1: [device('phone-a')] },
        optedOut: ['+14045550001'],
      });

      expect(await service.notifyNewMessage({ ...line, conversationId: 'c2' }, group, ['u1'])).toBe(1);
      expect(optOuts.isOptedOut).not.toHaveBeenCalled();
    });

    it('skips the in-app line of "Send to tech" — the job push already covered that click', async () => {
      const { service, expo } = makeNotifier({ devices: { u1: [device('phone-a')] } });

      const outcome = await service.notifyNewMessage(
        { ...line, automationRuleId: 'send-to-tech:in_app' },
        team,
        ['u1'],
      );

      expect(outcome).toBe('already_pushed');
      expect(expo.send).not.toHaveBeenCalled();
    });

    it('still pushes an ordinary automation line', async () => {
      const { service } = makeNotifier({ devices: { u1: [device('phone-a')] } });
      expect(await service.notifyNewMessage({ ...line, automationRuleId: 'new-job-sms' }, team, ['u1'])).toBe(1);
    });

    it('does nothing when nobody in the thread has a phone registered', async () => {
      const { service, expo } = makeNotifier({ devices: {} });
      expect(await service.notifyNewMessage(line, team, ['u1'])).toBe('no_device');
      expect(expo.send).not.toHaveBeenCalled();
    });

    it('never lets a failed push take down the send that produced it', async () => {
      const { service, settings } = makeNotifier({ devices: { u1: [device('phone-a')] } });
      settings.get.mockRejectedValueOnce(new Error('table is throttling'));

      await expect(service.notifyNewMessage(line, team, ['u1'])).resolves.toBe('failed');
    });
  });

  describe('with the flag off', () => {
    it('reads nothing and sends nothing, on either entry point, with one log line each', async () => {
      const { service, expo, devices, settings, optOuts } = makeNotifier({
        enabled: false,
        devices: { t1: [device('phone-a', 't1')], u1: [device('phone-b')] },
      });
      const log = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

      expect(await service.notifyJobSentToTech(JOB)).toBe('disabled');
      expect(await service.notifyNewMessage(createMockMessage({ sentByUserId: 'x' }), createMockConversation(), ['u1'])).toBe(
        'disabled',
      );

      expect(expo.send).not.toHaveBeenCalled();
      expect(devices.listByUser).not.toHaveBeenCalled();
      expect(devices.listByUsers).not.toHaveBeenCalled();
      expect(settings.get).not.toHaveBeenCalled();
      expect(optOuts.isOptedOut).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(2);
      expect(log.mock.calls.every(([line]) => String(line).includes('PUSH_ENABLED'))).toBe(true);
    });
  });
});
