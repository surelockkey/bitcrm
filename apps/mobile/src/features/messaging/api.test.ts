import { ApiError } from '../../lib/api/errors';
import { http } from '../../lib/api/http';
import {
  getJobClientThread,
  lookupClientText,
  sendClientText,
  type ClientThread,
} from './api';

jest.mock('../../lib/api/http', () => ({
  http: { get: jest.fn(), post: jest.fn() },
}));

const mockHttp = http as jest.Mocked<typeof http>;

/**
 * The three calls behind texting a client. Their paths are pinned here
 * because each one carries a guarantee the app leans on: the thread is found
 * *by job* (so the server can check the caller is on it), the lookup is by
 * contact, and the send opens the thread if there is not one yet.
 */
describe('the client thread', () => {
  beforeEach(() => {
    mockHttp.get.mockReset();
    mockHttp.post.mockReset();
  });

  it('reads the thread of a job, not of a contact the phone guessed at', async () => {
    const thread = { id: 'conv-client' } as ClientThread;
    mockHttp.get.mockResolvedValue(thread);

    await expect(getJobClientThread('deal-7')).resolves.toEqual(thread);
    expect(mockHttp.get).toHaveBeenCalledWith('/messaging/conversations/by-job/deal-7');
  });

  // A job booked this morning has no thread. That is the empty state, and the
  // screen that shows it offers the first line rather than an error.
  it('answers null when nobody has written to this client yet', async () => {
    mockHttp.get.mockRejectedValue(new ApiError(404, 'Conversation not found'));
    await expect(getJobClientThread('deal-7')).resolves.toBeNull();
  });

  it('still throws anything that is not a 404', async () => {
    mockHttp.get.mockRejectedValue(new ApiError(403, 'not your job'));
    await expect(getJobClientThread('deal-7')).rejects.toBeInstanceOf(ApiError);
  });

  it('asks whether this client can be texted at all', async () => {
    mockHttp.get.mockResolvedValue({ conversation: null, optOut: null, canText: true });

    await lookupClientText('contact-9');
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/messaging/conversations/text-lookup?partyKind=contact&partyId=contact-9',
    );
  });

  it('sends by contact and job, on the queue row’s own id, as SMS', async () => {
    mockHttp.post.mockResolvedValue({ id: 'm-1' });

    await sendClientText({
      clientMessageId: 'row-1',
      contactId: 'contact-9',
      dealId: 'deal-7',
      body: 'I am outside',
    });

    // `POST /messages`, not `POST /conversations/:id/messages`: it finds or
    // opens the thread, so a first text works from a phone that has never
    // seen one. `dealId` is what the `assigned_only` scope check reads.
    expect(mockHttp.post).toHaveBeenCalledWith('/messaging/messages', {
      clientMessageId: 'row-1',
      contactId: 'contact-9',
      dealId: 'deal-7',
      body: 'I am outside',
      channel: 'sms',
    });
  });
});
