/**
 * The jobs list's Search box, the Workiz way (jobslist notes, probed live on
 * 2026-10-08): a case-insensitive piece of the client's name, the Job ID,
 * phone digits typed any way, the address, the job type, the job name, the
 * email or the client's company — inside the open tab and the filters. Never
 * the technician, never the tags.
 *
 * DynamoDB has no case-insensitive match, so what the box can find is kept on
 * the job row already folded, in two halves with one writer each:
 *
 *   searchText / searchDigits              the job's own fields (deal-service writes them)
 *   clientSearchText / clientSearchDigits  the client record's (crm owns it; kept by events)
 *
 * and the box's text is folded the same way and matched with `contains()`.
 * The job type is not copied onto the job: its name is matched against the
 * catalog at query time, so renaming a type never leaves stale rows behind.
 */
import {
  DEAL_SEARCH_INPUTS,
  clientSearchAttributes,
  dealSearchAttributes,
  foldSearchText,
  matchesTextSearch,
  parseTextSearch,
  textSearchExpression,
} from 'src/deals/deal-search';

describe('foldSearchText', () => {
  it('lower-cases, folds accents and collapses whitespace', () => {
    expect(foldSearchText('  José   DE la  Cruz ')).toBe('jose de la cruz');
  });

  it('treats a missing value as empty', () => {
    expect(foldSearchText(undefined)).toBe('');
    expect(foldSearchText(null)).toBe('');
  });
});

describe('dealSearchAttributes — the job’s own half', () => {
  const row = {
    dealNumber: '5TU7ZA',
    jobName: 'Mailbox  Lock',
    clientName: { firstName: 'Dustin', lastName: 'Roselle' },
    address: { street: '1200 Elm St', unit: 'Apt 4', city: 'Princeton', state: 'TX', zip: '75407' },
    emailAddress: 'Dustin@Example.com',
    clientCompanyName: 'Acme Property Mgmt',
    primaryPhone: '+14693961234',
    secondaryPhone: '(817) 555-0199',
    phones: ['+14693961234'],
    // Never searched (Workiz does not either).
    tagIds: ['tag-needs-a-call'],
    assignedTechIds: ['tech-daniel'],
    notes: 'gate code 1234',
  };

  it('holds the Job ID (with its #), the job name, the "Just here" name, the address, the email and the company', () => {
    const { searchText } = dealSearchAttributes(row);
    for (const piece of ['#5tu7za', 'mailbox lock', 'dustin roselle', '1200 elm st', 'princeton', 'tx', '75407', 'dustin@example.com', 'acme property mgmt']) {
      expect(searchText).toContain(piece);
    }
  });

  it('leaves out what Workiz does not search: tags, technicians, notes', () => {
    const { searchText } = dealSearchAttributes(row);
    expect(searchText).not.toContain('tag-needs-a-call');
    expect(searchText).not.toContain('tech-daniel');
    expect(searchText).not.toContain('gate code');
  });

  it('keeps every field apart, so no match runs from one into the next', () => {
    const { searchText } = dealSearchAttributes(row);
    expect(searchText).not.toContain('princeton tx');
    expect(searchText.split('\n')).toEqual(expect.arrayContaining(['princeton', 'tx']));
  });

  it('a legacy numeric Job ID is text too', () => {
    expect(dealSearchAttributes({ dealNumber: 1042 }).searchText).toContain('#1042');
  });

  it('keeps the job’s numbers as bare digits, once each', () => {
    const { searchDigits } = dealSearchAttributes(row);
    expect(searchDigits.split('\n').sort()).toEqual(['14693961234', '8175550199']);
  });

  it('a job with nothing searchable has empty halves, not missing ones', () => {
    expect(dealSearchAttributes({})).toEqual({ searchText: '', searchDigits: '' });
  });

  it('names every attribute it reads as an input, so a write of one restamps the row', () => {
    for (const field of ['dealNumber', 'jobName', 'clientName', 'address', 'emailAddress', 'clientCompanyName', 'primaryPhone', 'secondaryPhone', 'phones']) {
      expect(DEAL_SEARCH_INPUTS.has(field)).toBe(true);
    }
    expect(DEAL_SEARCH_INPUTS.has('tagIds')).toBe(false);
  });
});

describe('clientSearchAttributes — the client record’s half', () => {
  it('holds the full name, every email and the company; the numbers as digits', () => {
    const attrs = clientSearchAttributes(
      { firstName: 'Kayleigh', lastName: "O'Neil", emails: ['K@x.com', 'office@x.com'], phones: ['+12145550100', '+12145550100'] },
      'Neil Holdings',
    );
    expect(attrs.clientSearchText.split('\n')).toEqual(["kayleigh o'neil", 'k@x.com', 'office@x.com', 'neil holdings']);
    expect(attrs.clientSearchDigits).toBe('12145550100');
  });

  it('a client with a first name only is still found by it', () => {
    expect(clientSearchAttributes({ firstName: 'Dustin', lastName: '' }).clientSearchText).toBe('dustin');
  });
});

describe('parseTextSearch — the box’s text', () => {
  it('nothing typed is no search', () => {
    expect(parseTextSearch(undefined, { numbers: true })).toBeUndefined();
    expect(parseTextSearch('   ', { numbers: true })).toBeUndefined();
  });

  it('is folded like the rows', () => {
    expect(parseTextSearch('  Dustin   ROSE ', { numbers: true })).toEqual({ text: 'dustin rose' });
  });

  it('phone-shaped text of four or more digits also matches the numbers, however it was formatted', () => {
    expect(parseTextSearch('8179', { numbers: true })).toEqual({ text: '8179', digits: '8179' });
    expect(parseTextSearch('469 396', { numbers: true })).toEqual({ text: '469 396', digits: '469396' });
    expect(parseTextSearch('(469) 396-12', { numbers: true })).toEqual({ text: '(469) 396-12', digits: '46939612' });
  });

  it('three digits are too few to be a number (zip and street numbers still match as text)', () => {
    expect(parseTextSearch('817', { numbers: true })).toEqual({ text: '817' });
  });

  it('letters make it text only — "5TU7" is a piece of a Job ID, not a number', () => {
    expect(parseTextSearch('5TU7', { numbers: true })).toEqual({ text: '5tu7' });
  });

  it('a caller who may not see numbers cannot search by one either (crm’s contacts.view_numbers rule)', () => {
    expect(parseTextSearch('8179', { numbers: false })).toEqual({ text: '8179' });
  });

  it('is cut to a sane length', () => {
    expect(parseTextSearch('x'.repeat(500), { numbers: true })!.text).toHaveLength(100);
  });
});

describe('matchesTextSearch — the in-memory twin of the filter', () => {
  const row = {
    jobTypeId: 'jt-service',
    ...dealSearchAttributes({ dealNumber: '5TU7ZA', address: { street: '1 Elm', city: 'Princeton', state: 'TX', zip: '75407' } }),
    ...clientSearchAttributes({ firstName: 'Dustin', lastName: 'Roselle', phones: ['+14693961234'] }),
  };

  it.each([
    ['client name', { text: 'rosel' }, true],
    ['part of the Job ID', { text: '5tu7' }, true],
    ['the Job ID typed with #', { text: '#5tu7' }, true],
    ['the city', { text: 'princeton' }, true],
    ['phone digits', { text: '469 396', digits: '469396' }, true],
    ['the job type, through the catalog', { text: 'serv', jobTypeIds: ['jt-service'] }, true],
    ['something else', { text: 'kayleigh' }, false],
    ['digits the client does not have', { text: '9999', digits: '9999' }, false],
  ])('%s', (_name, search, expected) => {
    expect(matchesTextSearch(row, search)).toBe(expected);
  });

  it('a row written before the attributes existed matches nothing (until the backfill)', () => {
    expect(matchesTextSearch({ jobTypeId: 'x' }, { text: 'dustin' })).toBe(false);
  });
});

describe('textSearchExpression — the FilterExpression fragment', () => {
  it('is one OR over both halves of the text', () => {
    const f = textSearchExpression({ text: 'dustin' });
    expect(f.expression).toBe('(contains(#searchText, :qText) OR contains(#clientSearchText, :qText))');
    expect(f.names).toEqual({ '#searchText': 'searchText', '#clientSearchText': 'clientSearchText' });
    expect(f.values).toEqual({ ':qText': 'dustin' });
  });

  it('adds the digits of both halves when the text is phone-shaped', () => {
    const f = textSearchExpression({ text: '8179', digits: '8179' });
    expect(f.expression).toContain('contains(#searchDigits, :qDigits)');
    expect(f.expression).toContain('contains(#clientSearchDigits, :qDigits)');
    expect(f.values[':qDigits']).toBe('8179');
  });

  it('adds the job types whose name matched, as IN lists of at most 100', () => {
    const ids = Array.from({ length: 130 }, (_, i) => `jt-${i}`);
    const f = textSearchExpression({ text: 'e', jobTypeIds: ids });
    const lists = f.expression.match(/#jobTypeId IN \(([^)]*)\)/g) ?? [];
    expect(lists).toHaveLength(2);
    expect(Object.keys(f.values).filter((k) => k.startsWith(':qType'))).toHaveLength(130);
    expect(f.names['#jobTypeId']).toBe('jobTypeId');
  });
});
