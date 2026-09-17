import { ApiError } from '../../lib/api/errors';
import { http } from '../../lib/api/http';
import {
  getConversation,
  getInboxCounters,
  getJobClientThread,
  listConversations,
  lookupClientText,
  sendClientText,
  type ClientThread,
} from './api';

jest.mock('../../lib/api/http', () => ({
  http: { get: jest.fn(), post: jest.fn(), paginated: jest.fn() },
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

/**
 * The inbox routes behind the Messages list. Their shapes are pinned because
 * each carries a decision: the list asks for no `kind` (it is filtered on the
 * phone, so the chips are instant and work with no signal), and the counters
 * are the ones scoped to the caller rather than the company's.
 */
describe('the conversation list', () => {
  beforeEach(() => {
    mockHttp.get.mockReset();
    (mockHttp.paginated as jest.Mock).mockReset();
  });

  it('asks for the whole inbox and filters the chips on the phone', async () => {
    (mockHttp.paginated as jest.Mock).mockResolvedValue({ data: [], pagination: {} });

    await listConversations();
    // No `kind=`: under `assigned_only` the server materialises the whole
    // assigned set either way, and "Team" is two kinds the parameter cannot
    // express.
    expect(mockHttp.paginated).toHaveBeenCalledWith('/messaging/conversations?view=all&limit=50');
  });

  it('carries a cursor for an inbox that does not fit in one page', async () => {
    (mockHttp.paginated as jest.Mock).mockResolvedValue({ data: [], pagination: {} });

    await listConversations('CUR-2', 25);
    expect(mockHttp.paginated).toHaveBeenCalledWith(
      '/messaging/conversations?view=all&limit=25&cursor=CUR-2',
    );
  });

  it('reads the counters the caller is scoped to', async () => {
    mockHttp.get.mockResolvedValue({ unreadConversations: 0, unreadByKind: {} });

    await getInboxCounters();
    expect(mockHttp.get).toHaveBeenCalledWith('/messaging/conversations/counters');
  });

  it('can name one thread, for a link opened before the list has loaded', async () => {
    mockHttp.get.mockResolvedValue({ id: 'conv-1' });

    await getConversation('conv-1');
    expect(mockHttp.get).toHaveBeenCalledWith('/messaging/conversations/conv-1');
  });

  it('lets a refusal through as a refusal', async () => {
    (mockHttp.paginated as jest.Mock).mockRejectedValue(new ApiError(403, 'outside your scope'));
    await expect(listConversations()).rejects.toMatchObject({ status: 403 });
  });
});
