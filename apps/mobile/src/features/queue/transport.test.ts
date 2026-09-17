import type { OutboxRecord } from '../../lib/queue/types';
import * as messaging from '../messaging/api';
import { performOutboxAction } from './transport';

jest.mock('../messaging/api');
jest.mock('../jobs/api');

const mockMessaging = messaging as jest.Mocked<typeof messaging>;

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

  it('answers with nothing — a message changes no job the screen is showing', async () => {
    await expect(performOutboxAction(row())).resolves.toBeUndefined();
  });
});
