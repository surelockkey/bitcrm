import type { OutboxRecord } from '../../lib/queue/types';
import * as messaging from '../messaging/api';
import * as timeclock from '../timeclock/api';
import { performOutboxAction } from './transport';

jest.mock('../messaging/api');
jest.mock('../jobs/api');
jest.mock('../timeclock/api');

const mockMessaging = messaging as jest.Mocked<typeof messaging>;
const mockTimeclock = timeclock as jest.Mocked<typeof timeclock>;

const row = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: 'row-1',
  userId: 'tech-1',
  kind: 'chat',
  dealId: '',
  payload: JSON.stringify({ conversationId: 'conv-1', body: 'door is locked' }),
  createdAt: 0,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  state: 'pending',
  ...over,
});

describe('performOutboxAction — a line to the office', () => {
  beforeEach(() => {
    mockMessaging.sendChatMessage.mockReset().mockResolvedValue({} as never);
    mockMessaging.openOfficeThread.mockReset();
  });

  it('sends it on the queue row’s own id, so a replay cannot post it twice', async () => {
    await performOutboxAction(row());

    expect(mockMessaging.sendChatMessage).toHaveBeenCalledWith('conv-1', {
      clientMessageId: 'row-1',
      channel: 'in_app',
      body: 'door is locked',
    });
    expect(mockMessaging.openOfficeThread).not.toHaveBeenCalled();
  });

  it('carries the job when the line was written from one', async () => {
    await performOutboxAction(row({ dealId: 'deal-7' }));

    expect(mockMessaging.sendChatMessage).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ dealId: 'deal-7' }),
    );
  });

  it('opens the thread the first time, for a phone that has never seen one', async () => {
    mockMessaging.openOfficeThread.mockResolvedValue({
      conversation: { id: 'new-conv' } as never,
      created: true,
    });

    await performOutboxAction(row({ payload: JSON.stringify({ body: 'first line' }) }));

    expect(mockMessaging.openOfficeThread).toHaveBeenCalledWith('tech-1');
    expect(mockMessaging.sendChatMessage).toHaveBeenCalledWith(
      'new-conv',
      expect.objectContaining({ body: 'first line' }),
    );
  });

  it('answers with the line the office stored, so the thread never goes blank', async () => {
    // The pending bubble disappears the moment the row is `done`. Without the
    // server's own copy in hand, nothing stands in its place until a refetch
    // answers — and nothing at all if the signal drops in between.
    const stored = { id: 'm-9', conversationId: 'conv-1', body: 'door is locked' };
    mockMessaging.sendChatMessage.mockResolvedValue(stored as never);

    await expect(performOutboxAction(row())).resolves.toEqual(stored);
  });
});

describe('performOutboxAction — the time clock', () => {
  beforeEach(() => {
    mockTimeclock.startClock.mockReset().mockResolvedValue({} as never);
    mockTimeclock.stopClock.mockReset().mockResolvedValue({} as never);
  });

  it('sends the phone’s own stamp with the start, alongside the contract’s fields', async () => {
    /*
     * The server stamps `startedAt` when the request arrives, and a row that
     * spent an hour in a basement would shorten the shift by an hour. The extra
     * field cannot break the call: user-service validates with
     * `whitelist: true` and no `forbidNonWhitelisted`, so today it is stripped
     * — and the day the backend accepts it, phones already in vans start
     * sending the truth.
     */
    await performOutboxAction(
      row({
        kind: 'timeclock_in',
        dealId: '',
        payload: JSON.stringify({
          source: 'mobile',
          clientStartedAt: '2026-09-17T09:03:00.000Z',
          lat: 41.76,
          lng: -72.68,
        }),
      }),
    );

    expect(mockTimeclock.startClock).toHaveBeenCalledWith({
      source: 'mobile',
      clientStartedAt: '2026-09-17T09:03:00.000Z',
      lat: 41.76,
      lng: -72.68,
    });
  });

  it('takes the job from the row, which is the one place it is recorded', async () => {
    await performOutboxAction(
      row({
        kind: 'timeclock_in',
        dealId: 'deal-7',
        payload: JSON.stringify({
          source: 'mobile',
          clientStartedAt: '2026-09-17T09:03:00.000Z',
        }),
      }),
    );

    expect(mockTimeclock.startClock).toHaveBeenCalledWith(
      expect.objectContaining({ dealId: 'deal-7' }),
    );
  });

  it('sends no job at all when the clock was started for the day', async () => {
    await performOutboxAction(
      row({
        kind: 'timeclock_in',
        dealId: '',
        payload: JSON.stringify({
          source: 'mobile',
          clientStartedAt: '2026-09-17T09:03:00.000Z',
        }),
      }),
    );

    expect(mockTimeclock.startClock.mock.calls[0]![0]).not.toHaveProperty('dealId');
  });

  it('stops the clock with the moment the technician tapped', async () => {
    await performOutboxAction(
      row({
        kind: 'timeclock_out',
        dealId: '',
        payload: JSON.stringify({ clientEndedAt: '2026-09-17T17:12:00.000Z' }),
      }),
    );

    expect(mockTimeclock.stopClock).toHaveBeenCalledWith({
      clientEndedAt: '2026-09-17T17:12:00.000Z',
    });
  });
});

describe('performOutboxAction — a text to the client', () => {
  beforeEach(() => {
    mockMessaging.sendClientText.mockReset().mockResolvedValue({} as never);
    mockMessaging.sendChatMessage.mockReset().mockResolvedValue({} as never);
  });

  const sms = (over: Partial<OutboxRecord> = {}) =>
    row({
      kind: 'client_sms',
      dealId: 'deal-7',
      payload: JSON.stringify({ contactId: 'contact-9', body: 'I am outside' }),
      ...over,
    });

  it('sends it on the row’s own id, and against the job it was written from', async () => {
    await performOutboxAction(sms());

    expect(mockMessaging.sendClientText).toHaveBeenCalledWith({
      clientMessageId: 'row-1',
      contactId: 'contact-9',
      // Not decoration: under `assigned_only` the server authorises the send
      // against this, and without it falls back to the thread's last job.
      dealId: 'deal-7',
      body: 'I am outside',
    });
  });

  // The two threads are separate kinds from the moment a row is written, so
  // nothing has to work out at send time which one a line was meant for.
  it('never reaches the office thread', async () => {
    await performOutboxAction(sms());
    expect(mockMessaging.sendChatMessage).not.toHaveBeenCalled();
    expect(mockMessaging.openOfficeThread).not.toHaveBeenCalled();
  });

  it('answers with the stored text, so the thread never goes blank', async () => {
    const stored = { id: 'm-3', conversationId: 'conv-client', body: 'I am outside' };
    mockMessaging.sendClientText.mockResolvedValue(stored as never);

    await expect(performOutboxAction(sms())).resolves.toEqual(stored);
  });
});
