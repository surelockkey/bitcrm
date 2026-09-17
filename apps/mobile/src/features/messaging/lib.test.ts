import { ApiError } from '../../lib/api/errors';
import type { QueueRecord } from '../../lib/queue/types';
import type { FeedMessage, TeamThread } from './api';
import {
  audienceChrome,
  bodyOf,
  clientFeedRows,
  clientSenderName,
  describeReadError,
  feedRows,
  feedWithLandedLine,
  flattenFeed,
  formatDayChip,
  formatMessageTime,
  isMine,
  isMineInClientThread,
  messageSk,
  officeThreadOf,
  pendingLines,
  pendingStatusText,
  recipientContactId,
  senderName,
  threadScreenEdges,
  unreadBadge,
} from './lib';

/** Built from local parts, so a day chip and a clock read the same in any timezone. */
const at = (y: number, m: number, d: number, h = 9, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

const message = (over: Partial<FeedMessage> = {}): FeedMessage => ({
  id: 'm1',
  conversationId: 'conv-1',
  channel: 'in_app',
  direction: 'outbound',
  status: 'sent',
  origin: 'user',
  body: 'Gate code is 4021',
  createdAt: at(2026, 9, 16, 12, 10),
  updatedAt: at(2026, 9, 16, 12, 10),
  ...over,
});

const thread = (over: Partial<TeamThread> = {}): TeamThread => ({
  id: 'conv-1',
  kind: 'team',
  partyKind: 'user',
  partyId: 'tech-1',
  addresses: { phones: [], emails: [] },
  state: 'open',
  unread: false,
  unreadCount: 0,
  flagged: false,
  viewerUnread: false,
  viewerUnreadCount: 0,
  createdAt: at(2026, 9, 1),
  updatedAt: at(2026, 9, 16),
  ...over,
});

const chatRow = (over: Partial<QueueRecord & { queue: 'outbox' }> = {}): QueueRecord =>
  ({
    queue: 'outbox',
    id: 'q1',
    userId: 'tech-1',
    kind: 'chat',
    dealId: '',
    payload: JSON.stringify({ conversationId: 'conv-1', body: 'On my way back' }),
    createdAt: new Date(at(2026, 9, 16, 13, 0)).getTime(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    state: 'pending',
    ...over,
  }) as QueueRecord;

describe('officeThreadOf', () => {
  it('picks the signed-in technician’s own thread, not the first row', () => {
    const mine = thread({ id: 'mine', partyId: 'tech-1' });
    const other = thread({ id: 'other', partyId: 'tech-2' });
    expect(officeThreadOf([other, mine], 'tech-1')?.id).toBe('mine');
  });

  it('has none when the technician has never been written to', () => {
    expect(officeThreadOf([], 'tech-1')).toBeUndefined();
    expect(officeThreadOf([thread({ partyId: 'tech-2' })], 'tech-1')).toBeUndefined();
  });

  it('takes a lone thread only while the phone does not know who is signed in', () => {
    expect(officeThreadOf([thread({ id: 'only' })], undefined)?.id).toBe('only');
    expect(
      officeThreadOf([thread({ id: 'a' }), thread({ id: 'b' })], undefined),
    ).toBeUndefined();
  });
});

describe('isMine', () => {
  it('goes by the author, because the server calls the technician’s own line inbound', () => {
    // send.service.ts:755 — on their own thread the employee is the party.
    expect(isMine(message({ sentByUserId: 'tech-1', direction: 'inbound' }), 'tech-1')).toBe(true);
    expect(isMine(message({ sentByUserId: 'office-9', direction: 'outbound' }), 'tech-1')).toBe(false);
  });

  it('does not put the office on the technician’s side when it writes on their thread', () => {
    // An office SMS to the technician's own handset is outbound and theirs.
    expect(isMine(message({ sentByUserId: 'office-9', channel: 'sms' }), 'tech-1')).toBe(false);
  });

  it('falls back to direction for imported history, which names no author', () => {
    expect(isMine(message({ sentByUserId: undefined, direction: 'inbound' }), 'tech-1')).toBe(true);
    expect(isMine(message({ sentByUserId: undefined, direction: 'outbound' }), 'tech-1')).toBe(false);
  });
});

describe('senderName', () => {
  it('names the technician’s own lines “You”', () => {
    expect(senderName(message(), true)).toBe('You');
  });

  it('uses the name the office line carries, and says “Office” when it carries none', () => {
    expect(senderName(message({ sentByName: 'Dana at dispatch' }), false)).toBe('Dana at dispatch');
    expect(senderName(message(), false)).toBe('Office');
  });

  it('marks an automatic line as one, rather than as a person', () => {
    expect(senderName(message({ origin: 'automation', sentByName: 'x' }), false)).toBe('Automation');
  });
});

describe('formatDayChip', () => {
  const now = new Date(2026, 8, 16, 15, 0);

  it('names today and yesterday instead of dating them', () => {
    expect(formatDayChip(at(2026, 9, 16, 8, 0), now)).toBe('Today');
    expect(formatDayChip(at(2026, 9, 15, 23, 0), now)).toBe('Yesterday');
  });

  it('spells an older day the way the web Inbox spells it', () => {
    expect(formatDayChip(at(2026, 9, 10, 9, 0), now)).toBe('Thursday,September 10 2026');
  });

  it('says nothing at all about a timestamp it cannot read', () => {
    expect(formatDayChip('not a date', now)).toBe('');
  });
});

describe('formatMessageTime', () => {
  it('is the clock alone — the date is on the chip above', () => {
    expect(formatMessageTime(at(2026, 9, 16, 12, 10))).toBe('12:10 PM');
    expect(formatMessageTime('nonsense')).toBe('');
  });
});

describe('bodyOf', () => {
  it('is the text, when there is text', () => {
    expect(bodyOf(message())).toBe('Gate code is 4021');
  });

  it('names the files on a line that carries nothing else', () => {
    expect(
      bodyOf({
        body: undefined,
        attachments: [
          { id: 'a', fileName: 'door.jpg', contentType: 'image/jpeg', status: 'stored' },
        ],
      }),
    ).toBe('(1 attachment — open BitCRM in the browser to see it)');
  });

  it('is empty for a line with neither, rather than inventing something', () => {
    expect(bodyOf({ body: undefined })).toBe('');
  });
});

describe('messageSk', () => {
  it('is the sort key the read marker stores', () => {
    expect(messageSk({ id: 'm1', createdAt: '2026-09-16T12:10:00.000Z' })).toBe(
      'MSG#2026-09-16T12:10:00.000Z#m1',
    );
  });
});

describe('pendingLines', () => {
  it('takes only this technician’s unsent chat rows, oldest first', () => {
    const lines = pendingLines([
      chatRow({ id: 'b', createdAt: 2 }),
      chatRow({ id: 'a', createdAt: 1 }),
      chatRow({ id: 'landed', state: 'done' }),
      chatRow({ id: 'a-note', kind: 'note', payload: '{"note":"x"}' }),
    ]);
    expect(lines.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('drops a row whose payload cannot be read rather than drawing an empty bubble', () => {
    expect(pendingLines([chatRow({ payload: 'not json' })])).toEqual([]);
    expect(pendingLines([chatRow({ payload: '{"conversationId":"c"}' })])).toEqual([]);
  });

  it('says what the queue is doing, in the queue’s own words', () => {
    const [waiting] = pendingLines([chatRow()]);
    expect(pendingStatusText(waiting!)).toBe('Waiting for a signal');
    const [sending] = pendingLines([chatRow({ state: 'sending' })]);
    expect(pendingStatusText(sending!)).toBe('Sending…');
    const [failed] = pendingLines([
      chatRow({ state: 'failed', lastError: 'Job is outside your data scope' }),
    ]);
    expect(pendingStatusText(failed!)).toBe('Not sent · Job is outside your data scope');
  });
});

describe('flattenFeed', () => {
  it('keeps one copy of a line two overlapping pages both carry', () => {
    const a = message({ id: 'a', createdAt: at(2026, 9, 16, 10) });
    const b = message({ id: 'b', createdAt: at(2026, 9, 16, 11) });
    const flat = flattenFeed([{ data: [b, a] }, { data: [a] }]);
    expect(flat.map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('is newest first whatever order the pages arrived in', () => {
    const old = message({ id: 'old', createdAt: at(2026, 9, 14, 9) });
    const recent = message({ id: 'recent', createdAt: at(2026, 9, 16, 9) });
    expect(flattenFeed([{ data: [old] }, { data: [recent] }]).map((m) => m.id)).toEqual([
      'recent',
      'old',
    ]);
  });
});

describe('feedWithLandedLine', () => {
  it('puts the office’s own copy where the pending bubble was', () => {
    const older = message({ id: 'older', createdAt: at(2026, 9, 16, 11) });
    const landed = message({ id: 'landed', createdAt: at(2026, 9, 16, 13) });
    const next = feedWithLandedLine(
      { pages: [{ data: [older], pagination: { nextCursor: 'c2' } }], pageParams: [undefined] },
      landed,
    );

    expect(next.pages[0]!.data.map((m) => m.id)).toEqual(['landed', 'older']);
    // Whatever "load older" was pointing at still is.
    expect(next.pages[0]!.pagination.nextCursor).toBe('c2');
  });

  it('gives a phone that has never loaded the feed a thread with the line in it', () => {
    const landed = message({ id: 'first-ever' });
    expect(feedWithLandedLine(undefined, landed).pages[0]!.data).toEqual([landed]);
  });

  it('does not add a line the feed already carries', () => {
    const landed = message({ id: 'landed' });
    const previous = {
      pages: [{ data: [landed], pagination: {} }],
      pageParams: [undefined],
    };
    expect(feedWithLandedLine(previous, landed)).toBe(previous);
  });
});

describe('feedRows', () => {
  const now = new Date(2026, 8, 16, 15, 0);

  it('puts the queued lines newest-of-all, where they will be once they land', () => {
    const rows = feedRows(
      [message({ id: 'from-office', createdAt: at(2026, 9, 16, 12, 10) })],
      pendingLines([chatRow({ id: 'q1' })]),
      'tech-1',
      now,
    );
    // Index 0 is the bottom of an inverted list: the newest line.
    expect(rows.map((r) => r.key)).toEqual(['pending:q1', 'from-office']);
    expect(rows[0]!.mine).toBe(true);
    expect(rows[0]!.status).toBe('Waiting for a signal');
  });

  it('draws a day chip on the first line of each day, and nowhere else', () => {
    const rows = feedRows(
      [
        message({ id: 'today-2', createdAt: at(2026, 9, 16, 12, 0) }),
        message({ id: 'today-1', createdAt: at(2026, 9, 16, 9, 0) }),
        message({ id: 'monday', createdAt: at(2026, 9, 14, 9, 0) }),
      ],
      [],
      'tech-1',
      now,
    );
    expect(rows.map((r) => r.dayLabel)).toEqual([undefined, 'Today', 'Monday,September 14 2026']);
  });

  it('names both sides and stamps the time', () => {
    const rows = feedRows(
      [
        message({ id: 'mine', sentByUserId: 'tech-1', direction: 'inbound', body: 'Done here' }),
        message({ id: 'theirs', sentByUserId: 'office-9', sentByName: 'Dana' }),
      ],
      [],
      'tech-1',
      now,
    );
    expect(rows[0]).toMatchObject({ mine: true, name: 'You', body: 'Done here', time: '12:10 PM' });
    expect(rows[1]).toMatchObject({ mine: false, name: 'Dana' });
  });

  it('never puts Yesterday under Today for a line queued across midnight', () => {
    // The queued line is drawn below the office's, whatever it is stamped. A
    // chip of its own typing day would then read backwards down the thread.
    const midnight = new Date(2026, 8, 17, 9, 0);
    const rows = feedRows(
      [message({ id: 'after-midnight', createdAt: at(2026, 9, 17, 0, 10) })],
      pendingLines([
        chatRow({ id: 'q1', createdAt: new Date(at(2026, 9, 16, 23, 50)).getTime() }),
      ]),
      'tech-1',
      midnight,
    );

    expect(rows.map((r) => r.key)).toEqual(['pending:q1', 'after-midnight']);
    expect(rows[0]!.dayLabel).toBeUndefined();
    expect(rows[1]!.dayLabel).toBe('Today');
    // The clock on it still says when it was actually typed.
    expect(rows[0]!.time).toBe('11:50 PM');
  });

  it('carries the job a line names, so it can be opened from the line', () => {
    const rows = feedRows(
      [
        message({ id: 'about-a-job', dealId: 'deal-7' }),
        message({ id: 'about-nothing', createdAt: at(2026, 9, 16, 11) }),
      ],
      [],
      'tech-1',
      now,
    );
    expect(rows[0]!.dealId).toBe('deal-7');
    expect(rows[1]!.dealId).toBeUndefined();
  });

  it('offers a retry on a line the queue gave up on, and on nothing else', () => {
    const rows = feedRows(
      [],
      pendingLines([
        chatRow({ id: 'bad', state: 'failed', lastError: 'Request failed', createdAt: 2 }),
        chatRow({ id: 'waiting', createdAt: 1 }),
      ]),
      'tech-1',
      now,
    );
    const failed = rows.find((r) => r.queueId === 'bad');
    expect(failed?.failed).toBe(true);
    expect(rows.find((r) => r.queueId === 'waiting')?.failed).toBe(false);
  });
});

describe('unreadBadge', () => {
  it('draws nothing at all rather than an empty circle', () => {
    expect(unreadBadge(0)).toBeUndefined();
    expect(unreadBadge(undefined)).toBeUndefined();
  });

  it('counts, and stops counting at nine', () => {
    expect(unreadBadge(3)).toBe('3');
    expect(unreadBadge(42)).toBe('9+');
  });
});

describe('threadScreenEdges', () => {
  it('keeps the composer off the home indicator when nothing sits under it', () => {
    // Opened from a job the thread is pushed over the tabs: no tab bar holds
    // the bottom strip, and iOS eats a tap that lands in the indicator's.
    expect(threadScreenEdges(true)).toContain('bottom');
  });

  it('leaves the bottom to the tab bar in the tab', () => {
    expect(threadScreenEdges(false)).not.toContain('bottom');
  });
});

describe('describeReadError', () => {
  it('calls no signal what it is, and promises what happens next', () => {
    const { title, body } = describeReadError(new ApiError(0, 'Unable to reach the server.'));
    expect(title).toBe('No signal');
    expect(body).toContain('sent when it does');
  });

  it('repeats the server’s own words for anything else', () => {
    expect(describeReadError(new ApiError(500, 'Upstream is down')).body).toBe('Upstream is down');
    expect(describeReadError(new ApiError(403, 'no')).title).toBe('Not your conversation');
  });
});

/* ---------------------------------------------- the thread with the client */

const smsRow = (over: Partial<QueueRecord & { queue: 'outbox' }> = {}): QueueRecord =>
  chatRow({
    kind: 'client_sms',
    dealId: 'deal-1',
    payload: JSON.stringify({ contactId: 'c1', body: 'I am outside' }),
    ...over,
  });

describe('audienceChrome', () => {
  // The whole point of one function: two sets of words that cannot converge,
  // because the same call site produces both.
  it('names the client in every place the client thread speaks', () => {
    const chrome = audienceChrome('client', { clientName: 'Ada Byron' });
    expect(chrome.title).toBe('Ada Byron');
    expect(chrome.subtitle).toContain('Client');
    expect(chrome.placeholder).toBe('Text Ada Byron');
    expect(chrome.banner).toContain('Ada Byron');
    expect(chrome.banner).toContain('The office is not on this thread');
    expect(chrome.inputLabel).toContain('Ada Byron');
  });

  it('falls back to "the client" rather than an empty sentence', () => {
    const chrome = audienceChrome('client');
    expect(chrome.title).toBe('Client');
    expect(chrome.placeholder).toBe('Text the client');
    expect(chrome.banner).toContain('the client');
    expect(audienceChrome('client', { clientName: '   ' }).title).toBe('Client');
  });

  it('says of the office thread that the client is not on it', () => {
    const chrome = audienceChrome('office');
    expect(chrome.title).toBe('Office');
    expect(chrome.placeholder).toBe('Write to the office');
    expect(chrome.banner).toContain('client is not on this thread');
  });

  it('keeps the office hint the job screen already promised', () => {
    expect(audienceChrome('office', { fromJob: true }).hint).toBe(
      'Goes to the office, linked to the job you came from.',
    );
    expect(audienceChrome('office').hint).toContain('waits here');
  });

  it('shares no wording at all between the two audiences', () => {
    const office = audienceChrome('office', { fromJob: true });
    const client = audienceChrome('client', { clientName: 'Ada Byron' });
    for (const key of ['title', 'subtitle', 'banner', 'placeholder', 'hint', 'inputLabel'] as const) {
      expect(client[key]).not.toBe(office[key]);
    }
  });
});

describe('pendingLines, by thread', () => {
  // The bug this exists to make impossible: a text meant for a client drawn
  // in the thread with the office, or the other way round.
  it('never hands one thread the other’s queued rows', () => {
    const rows = [chatRow({ id: 'to-office' }), smsRow({ id: 'to-client' })];
    expect(pendingLines(rows).map((l) => l.id)).toEqual(['to-office']);
    expect(
      pendingLines(rows, { kind: 'client_sms', dealId: 'deal-1' }).map((l) => l.id),
    ).toEqual(['to-client']);
  });

  it('draws a client text on the job it was sent from', () => {
    const rows = [
      smsRow({ id: 'here', dealId: 'deal-1' }),
      smsRow({ id: 'elsewhere', dealId: 'deal-2' }),
    ];
    expect(
      pendingLines(rows, { kind: 'client_sms', dealId: 'deal-1' }).map((l) => l.id),
    ).toEqual(['here']);
  });

  // A technician has one thread with the office, so a line written from
  // another job still belongs in it.
  it('keeps every office line in the one office thread, whatever job it names', () => {
    const rows = [chatRow({ id: 'a', dealId: 'deal-1' }), chatRow({ id: 'b', dealId: 'deal-2' })];
    expect(pendingLines(rows).map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('recipientContactId', () => {
  const clientThread = (partyId?: string, partyKind = 'contact') =>
    ({ partyKind, partyId }) as Parameters<typeof recipientContactId>[0];

  // The thread came from `by-job`, which the server resolved from the job as
  // it stands now; the job's own `contactId` is whatever the last list fetch
  // left on this phone. When dispatch moves a job to another client, sending
  // to the stale one files the words in a conversation nobody is reading.
  it('addresses the party of the thread on screen, not the job’s cached contact', () => {
    expect(recipientContactId(clientThread('contact-new'), 'contact-old')).toBe(
      'contact-new',
    );
  });

  it('falls back to the job’s contact when nobody has opened a thread yet', () => {
    expect(recipientContactId(null, 'contact-old')).toBe('contact-old');
    expect(recipientContactId(undefined, 'contact-old')).toBe('contact-old');
  });

  // `POST /messages` takes a contact or a bare number. A company thread has
  // nobody this screen can text, and passing its id as a contact would be a
  // send to an id that is not one.
  it('refuses to read a company thread’s party as a contact', () => {
    expect(recipientContactId(clientThread('company-3', 'company'), undefined)).toBeUndefined();
    expect(recipientContactId(clientThread('company-3', 'company'), 'contact-old')).toBe(
      'contact-old',
    );
  });

  it('answers with nothing for a job that has no client on it at all', () => {
    expect(recipientContactId(null, undefined)).toBeUndefined();
    expect(recipientContactId(null, '')).toBeUndefined();
  });
});

describe('who wrote what, in a client thread', () => {
  it('counts only the technician’s own lines as theirs', () => {
    expect(isMineInClientThread(message({ sentByUserId: 'tech-1' }), 'tech-1')).toBe(true);
    expect(isMineInClientThread(message({ sentByUserId: 'office-9' }), 'tech-1')).toBe(false);
  });

  // `isMine` reads an author-less inbound line as the viewer's own, which is
  // right for imported team history and catastrophic here: it would put the
  // client's own words on the technician's side, under their name.
  it('never reads the client’s own words as the technician’s', () => {
    const fromClient = message({ direction: 'inbound', sentByUserId: undefined });
    expect(isMine(fromClient, 'tech-1')).toBe(true);
    expect(isMineInClientThread(fromClient, 'tech-1')).toBe(false);
  });

  it('names each side the way a technician would', () => {
    const mine = message({ sentByUserId: 'tech-1' });
    const fromOffice = message({ sentByUserId: 'office-9', sentByName: 'Dana' });
    const fromClient = message({ direction: 'inbound', sentByUserId: undefined });
    const automated = message({ origin: 'automation', sentByUserId: undefined });

    expect(clientSenderName(mine, 'tech-1', 'Ada Byron')).toBe('You');
    expect(clientSenderName(fromOffice, 'tech-1', 'Ada Byron')).toBe('Dana');
    expect(clientSenderName(fromClient, 'tech-1', 'Ada Byron')).toBe('Ada Byron');
    expect(clientSenderName(fromClient, 'tech-1', undefined)).toBe('Client');
    expect(clientSenderName(automated, 'tech-1', 'Ada Byron')).toBe('Automation');
  });
});

describe('clientFeedRows', () => {
  it('puts the technician’s own words on the right and everyone else’s on the left', () => {
    const rows = clientFeedRows(
      [
        message({ id: 'mine', sentByUserId: 'tech-1', body: 'On my way' }),
        message({ id: 'theirs', direction: 'inbound', body: 'Gate is locked' }),
      ],
      [],
      'tech-1',
      'Ada Byron',
      new Date(at(2026, 9, 16, 14)),
    );
    expect(rows.map((r) => [r.mine, r.name])).toEqual([
      [true, 'You'],
      [false, 'Ada Byron'],
    ]);
  });

  it('shows a queued text under the last one that landed, with the queue’s words', () => {
    const rows = clientFeedRows(
      [message({ id: 'landed', createdAt: at(2026, 9, 16, 12) })],
      pendingLines([smsRow({ id: 'q1' })], { kind: 'client_sms', dealId: 'deal-1' }),
      'tech-1',
      'Ada Byron',
      new Date(at(2026, 9, 16, 14)),
    );
    // Newest first, as the inverted list wants: the queued line sits below the
    // office's last one on screen.
    expect(rows[0]!.key).toBe('pending:q1');
    expect(rows[0]!.status).toBe('Waiting for a signal');
    expect(rows[0]!.queueId).toBe('q1');
  });

  it('carries the job a line names, so another job can be opened from it', () => {
    const [row] = clientFeedRows(
      [message({ id: 'm', dealId: 'deal-9' })],
      [],
      'tech-1',
      'Ada Byron',
      new Date(at(2026, 9, 16, 14)),
    );
    expect(row!.dealId).toBe('deal-9');
  });

  it('chips the days the same way the office thread does', () => {
    const rows = clientFeedRows(
      [
        message({ id: 'today', createdAt: at(2026, 9, 16, 12) }),
        message({ id: 'before', createdAt: at(2026, 9, 15, 12) }),
      ],
      [],
      'tech-1',
      'Ada Byron',
      new Date(at(2026, 9, 16, 14)),
    );
    expect(rows[0]!.dayLabel).toBe('Today');
    expect(rows[1]!.dayLabel).toBe('Yesterday');
  });
});

describe('describeReadError, in a client thread', () => {
  it('explains a 403 as the job it belongs to, not as a role', () => {
    expect(describeReadError(new ApiError(403, 'no'), 'client').body).toContain(
      'a job you are not on',
    );
    expect(describeReadError(new ApiError(403, 'no')).body).toContain('your role');
  });
});
