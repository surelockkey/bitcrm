import {
  callCsvHeader,
  callCsvRow,
  callStatusWords,
  csvField,
  formatWzCallTime,
  type CallCsvContext,
} from '../../src/calls/call-export';
import { type EnrichedCall } from '../../src/calls/party-resolver';

/**
 * «Export» на сторінці дзвінків — CSV зі стовпцями Workiz (`csv_columns` у
 * запиті `/node-voice/calls/report/`): Status, From, To, Time, Call Flow,
 * Ad Source, Tags, Answered By, Jobs & Leads, Revenue.
 */

const call = (over: Partial<EnrichedCall> = {}): EnrichedCall => ({
  callSid: 'CA1',
  direction: 'inbound',
  status: 'completed',
  from: '+18572949311',
  to: '+12034036303',
  answeredAt: '2026-10-08T19:15:05.000Z',
  startedAt: '2026-10-08T19:15:00.000Z',
  updatedAt: '2026-10-08T19:16:00.000Z',
  ...over,
});

const ctx = (over: Partial<CallCsvContext> = {}): CallCsvContext => ({
  money: true,
  sourceName: (id) => ({ s1: 'SURE CT NEW HAVEN GMB' })[id],
  tagName: (id) => ({ t1: 'WRONG NUMBER', t2: 'Tech Call' })[id],
  jobNumber: (id) => ({ d1: '375982' })[id],
  jobTotal: (id) => ({ d1: 692.8 })[id],
  ...over,
});

describe('callCsvHeader', () => {
  it('is Workiz’s ten columns, in Workiz’s order', () => {
    expect(callCsvHeader(true)).toBe('Status,From,To,Time,Call Flow,Ad Source,Tags,Answered By,Jobs & Leads,Revenue');
  });

  it('drops Revenue for a viewer without financials.view', () => {
    expect(callCsvHeader(false)).toBe('Status,From,To,Time,Call Flow,Ad Source,Tags,Answered By,Jobs & Leads');
  });
});

describe('callStatusWords — the Status glyph’s tooltip, in words', () => {
  it.each([
    [{ status: 'in-progress' }, 'Active call'],
    [{ status: 'ringing', answeredAt: undefined }, 'Active call'],
    [{}, 'Incoming call'],
    [{ status: 'no-answer', answeredAt: undefined }, 'Missed call'],
    [{ direction: 'outbound' }, 'Outgoing call'],
    [{ direction: 'outbound', status: 'busy', answeredAt: undefined }, 'No answer'],
  ] as const)('%j → %s', (over, words) => {
    expect(callStatusWords(call(over as Partial<EnrichedCall>))).toBe(words);
  });
});

describe('formatWzCallTime', () => {
  it('prints Workiz’s "Thu Oct 8th, 3:15PM" on the account clock', () => {
    expect(formatWzCallTime('2026-10-08T19:15:00.000Z')).toBe('Thu Oct 8th, 3:15PM');
    expect(formatWzCallTime('2026-10-01T04:05:00.000Z')).toBe('Thu Oct 1st, 12:05AM');
    expect(formatWzCallTime('2026-10-22T16:00:00.000Z')).toBe('Thu Oct 22nd, 12:00PM');
    expect(formatWzCallTime('2026-10-13T16:00:00.000Z')).toBe('Tue Oct 13th, 12:00PM');
  });

  it('a broken instant is blank', () => {
    expect(formatWzCallTime('nope')).toBe('');
  });
});

describe('csvField', () => {
  it('quotes what must be quoted and defuses a would-be formula', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-5', true)).toBe('-5');
  });
});

/** A CSV line split into its fields, quotes understood. */
function cellsOf(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

describe('callCsvRow', () => {
  it('prints one call as Workiz’s row', () => {
    const row = callCsvRow(
      call({
        fromParty: { kind: 'contact', id: 'c1', name: 'Client 9311' },
        toParty: { kind: 'user', id: 'u1', name: '(1) (Amber) 19 Dispatcher' },
        participants: [{ userId: 'u1', role: 'answered', at: '2026-10-08T19:15:05.000Z', name: '(1) (Amber) 19 Dispatcher' }],
        flowName: '(2-CT-GMB) SURE CT GMB',
        sourceId: 's1',
        tagIds: ['t1', 't2'],
        dealId: 'd1',
      }),
      ctx(),
    );

    expect(row).toBe(
      'Incoming call,Client 9311 (857) 294-9311,(1) (Amber) 19 Dispatcher (203) 403-6303,"Thu Oct 8th, 3:15PM",' +
        '(2-CT-GMB) SURE CT GMB,SURE CT NEW HAVEN GMB,"WRONG NUMBER, Tech Call",(1) (Amber) 19 Dispatcher,Job 375982,692.80',
    );
  });

  it('a masked number is withheld — the name stays', () => {
    const row = callCsvRow(
      call({ from: undefined, fromMasked: true, fromParty: { kind: 'contact', id: 'c1', name: 'Client 9311' } } as never),
      ctx(),
    );

    expect(cellsOf(row)[1]).toBe('Client 9311');
  });

  it('a bare number prints as the number', () => {
    expect(cellsOf(callCsvRow(call(), ctx()))[1]).toBe('(857) 294-9311');
  });

  it('an imported job that never became a deal shows Workiz’s serial; no revenue', () => {
    const row = callCsvRow(call({ jobSerial: 375001 } as never), ctx());
    const cells = cellsOf(row);

    expect(cells[cells.length - 2]).toBe('Job 375001');
    expect(cells[cells.length - 1]).toBe('');
  });

  it('a job with nothing billed leaves Revenue blank, as Workiz does', () => {
    const cells = cellsOf(callCsvRow(call({ dealId: 'd1' }), ctx({ jobTotal: () => 0 })));

    expect(cells[cells.length - 1]).toBe('');
  });

  it('Answered By falls back to the name Workiz recorded on an imported call', () => {
    const cells = cellsOf(callCsvRow(call({ answeredByName: 'Emergency ctm 2' } as never), ctx()));

    expect(cells[7]).toBe('Emergency ctm 2');
  });

  it('no Revenue cell without money', () => {
    expect(cellsOf(callCsvRow(call({ dealId: 'd1' }), ctx({ money: false })))).toHaveLength(9);
  });

  it('an archived tag or source nobody can name is left out rather than printed as an id', () => {
    const cells = cellsOf(callCsvRow(call({ sourceId: 'gone', tagIds: ['t1', 'gone'] }), ctx()));

    expect(cells[5]).toBe('');
    expect(cells[6]).toBe('WRONG NUMBER');
  });
});
