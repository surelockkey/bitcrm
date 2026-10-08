/**
 * backfill:deal-search — every job written before the search halves existed
 * (every imported Workiz job) is invisible to the jobs list's Search box until
 * it carries them. The plan per row is pure; the script around it scans the
 * deals table and crm's contacts + companies tables and writes only what
 * differs (idempotent, upsert-only, conditional on `updatedAt`).
 */
import { planDealSearch, clientIndexEntry } from '../../../src/scripts/backfill-deal-search';
import { clientSearchAttributes, dealSearchAttributes } from '../../../src/deals/deal-search';

describe('backfill:deal-search — what each job needs', () => {
  const row = {
    PK: 'DEAL#d1',
    SK: 'METADATA',
    id: 'd1',
    contactId: 'c1',
    updatedAt: '2026-09-01T00:00:00.000Z',
    dealNumber: 'K4T9ZW',
    address: { street: '1 Elm', city: 'Plano', state: 'TX', zip: '75023' },
    primaryPhone: '+14693961234',
  };
  const client = clientSearchAttributes({ firstName: 'Ann', lastName: 'Lee', phones: ['+12145550100'], emails: ['ann@x.com'] });

  it('stamps both halves on an imported job that has neither', () => {
    expect(planDealSearch(row, client)).toEqual({
      action: 'set',
      attrs: { ...dealSearchAttributes(row), ...client },
    });
  });

  it('a second run changes nothing', () => {
    expect(planDealSearch({ ...row, ...dealSearchAttributes(row), ...client }, client)).toEqual({ action: 'same' });
  });

  it('rewrites only the attribute that went stale', () => {
    const stale = { ...row, ...dealSearchAttributes(row), clientSearchText: 'ann smith', clientSearchDigits: '12145550100' };
    expect(planDealSearch(stale, client)).toEqual({ action: 'set', attrs: { clientSearchText: client.clientSearchText } });
  });

  it('a client crm does not hold leaves the client half alone — the job’s own half is still written', () => {
    expect(planDealSearch(row, undefined)).toEqual({ action: 'set', attrs: dealSearchAttributes(row) });
    expect(planDealSearch({ ...row, ...dealSearchAttributes(row) }, undefined)).toEqual({ action: 'same' });
  });
});

describe('backfill:deal-search — the client index built from crm’s tables', () => {
  it('folds a contact row and its company title into the client half', () => {
    const companies = new Map([['co-1', 'Lee Holdings']]);
    expect(
      clientIndexEntry({ id: 'c1', firstName: 'Ann', lastName: 'Lee', phones: ['+12145550100'], emails: ['ann@x.com'], companyId: 'co-1' }, companies),
    ).toEqual(['c1', clientSearchAttributes({ firstName: 'Ann', lastName: 'Lee', phones: ['+12145550100'], emails: ['ann@x.com'] }, 'Lee Holdings')]);
  });

  it('tolerates the shapes an import leaves behind (no phones, no emails, unknown company)', () => {
    expect(clientIndexEntry({ id: 'c2', firstName: 'Bo' }, new Map())).toEqual(['c2', { clientSearchText: 'bo', clientSearchDigits: '' }]);
  });
});
