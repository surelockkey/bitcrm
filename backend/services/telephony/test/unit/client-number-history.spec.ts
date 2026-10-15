import { ClientNumberHistory } from '../../src/calls/client-number-history';
import { type CallRecord } from '../../src/calls/calls.repository';

/**
 * Which company numbers a client has been talking to, newest first — what
 * the masked call ("call me about this job", 2026-10-15) shows the client:
 * "from the number the client has been talking to".
 *
 * Two sources: telephony's own call log (PartyIndex, the client's frozen
 * calls — inbound ⇒ the number they rang, outbound ⇒ the number we showed)
 * and messaging's SMS thread (its internal business-number route). Whichever
 * is newer comes first. Messaging being unreachable leaves the calls; the
 * calls being unreadable leaves the SMS. Never an error — a caller id is not
 * worth a call.
 */

const CLIENT = '+12035550177';
const ATL = '+14045550100';
const SAV = '+19125550200';
const MAIN = '+15555550000';

const call = (over: Partial<CallRecord>): CallRecord => ({
  callSid: `CA${Math.random().toString(36).slice(2)}`,
  status: 'completed',
  startedAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:05:00.000Z',
  ...over,
});
const outbound = (from: string, startedAt: string, over: Partial<CallRecord> = {}) =>
  call({ direction: 'outbound', from, to: CLIENT, startedAt, ...over });
const inbound = (to: string, startedAt: string, over: Partial<CallRecord> = {}) =>
  call({ direction: 'inbound', from: CLIENT, to, startedAt, ...over });

function fetchAnswering(answer: { ok: boolean; status?: number; body?: unknown } | Error) {
  return jest.fn(async () => {
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 500),
      json: async () => answer.body,
    } as Response;
  });
}
const sms = (businessNumber: string, at?: string) =>
  fetchAnswering({ ok: true, body: { success: true, data: { businessNumber, ...(at && { at }) } } });
const noSms = () => fetchAnswering({ ok: true, body: { success: true, data: null } });

function make(calls: CallRecord[] | Error) {
  const repo = {
    listByParty: jest.fn(async () => {
      if (calls instanceof Error) throw calls;
      return { items: calls };
    }),
  };
  return { history: new ClientNumberHistory(repo as never), repo };
}

describe('ClientNumberHistory.numbersFor', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reads the client’s calls off the party index, newest first', async () => {
    global.fetch = noSms() as never;
    const { history, repo } = make([outbound(ATL, '2026-10-10T10:00:00.000Z')]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([ATL]);
    expect(repo.listByParty).toHaveBeenCalledWith('contact', 'contact-1', expect.any(Number));
  });

  it('an outbound call counts the number we showed; an inbound one the number they rang', async () => {
    global.fetch = noSms() as never;
    const { history } = make([
      inbound(SAV, '2026-10-10T10:00:00.000Z'),
      outbound(ATL, '2026-10-09T10:00:00.000Z'),
    ]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([SAV, ATL]);
  });

  it('the last call wins over an older SMS', async () => {
    global.fetch = sms(MAIN, '2026-10-01T09:00:00.000Z') as never;
    const { history } = make([outbound(ATL, '2026-10-10T10:00:00.000Z')]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([ATL, MAIN]);
  });

  it('a newer SMS wins over an older call', async () => {
    global.fetch = sms(MAIN, '2026-10-12T09:00:00.000Z') as never;
    const { history } = make([outbound(ATL, '2026-10-10T10:00:00.000Z')]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([MAIN, ATL]);
  });

  it('an SMS number whose time messaging no longer knows goes after every dated call', async () => {
    global.fetch = sms(MAIN) as never;
    const { history } = make([outbound(ATL, '2026-01-10T10:00:00.000Z')]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([ATL, MAIN]);
  });

  it('each number once, at its newest', async () => {
    global.fetch = sms(ATL, '2026-10-05T09:00:00.000Z') as never;
    const { history } = make([
      outbound(ATL, '2026-10-10T10:00:00.000Z'),
      inbound(SAV, '2026-10-08T10:00:00.000Z'),
      inbound(ATL, '2026-10-01T10:00:00.000Z'),
    ]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([ATL, SAV]);
  });

  it('skips calls that never reached the client, internal legs, and sides that are not numbers', async () => {
    global.fetch = noSms() as never;
    const { history } = make([
      outbound(MAIN, '2026-10-14T10:00:00.000Z', { status: 'failed' }),
      inbound(MAIN, '2026-10-13T10:00:00.000Z', { status: 'blocked' }),
      outbound(MAIN, '2026-10-12T10:00:00.000Z', { internalLegOf: 'CAother' }),
      outbound('', '2026-10-11T10:00:00.000Z'),
      call({ from: CLIENT, to: MAIN, startedAt: '2026-10-11T09:00:00.000Z' }), // no direction
      outbound(ATL, '2026-10-10T10:00:00.000Z', { status: 'no-answer' }),
    ]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([ATL]);
  });

  it('asks messaging for the client’s SMS number with the internal secret', async () => {
    const fetchMock = noSms();
    global.fetch = fetchMock as never;
    const { history } = make([]);

    await history.numbersFor('contact 1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(
      /\/api\/messaging\/conversations\/internal\/by-party\/contact\/contact%201\/business-number$/,
    );
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBeDefined();
    expect(init.signal).toBeDefined();
  });

  it('messaging unreachable ⇒ the calls alone, no error', async () => {
    global.fetch = fetchAnswering(new Error('ECONNREFUSED')) as never;
    const { history } = make([outbound(ATL, '2026-10-10T10:00:00.000Z')]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([ATL]);
  });

  it('messaging answering an error ⇒ the calls alone', async () => {
    global.fetch = fetchAnswering({ ok: false, status: 503 }) as never;
    const { history } = make([outbound(ATL, '2026-10-10T10:00:00.000Z')]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([ATL]);
  });

  it('the call log unreadable ⇒ the SMS alone, no error', async () => {
    global.fetch = sms(MAIN, '2026-10-12T09:00:00.000Z') as never;
    const { history } = make(new Error('dynamo throttled'));

    await expect(history.numbersFor('contact-1')).resolves.toEqual([MAIN]);
  });

  it('no history at all ⇒ nothing, and no contact ⇒ nothing asked', async () => {
    const fetchMock = noSms();
    global.fetch = fetchMock as never;
    const { history, repo } = make([]);

    await expect(history.numbersFor('contact-1')).resolves.toEqual([]);
    await expect(history.numbersFor('')).resolves.toEqual([]);
    expect(repo.listByParty).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
