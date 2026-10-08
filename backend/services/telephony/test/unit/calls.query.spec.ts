import { BadRequestException } from '@nestjs/common';
import { callsFilterFromQuery } from '../../src/calls/call-query';

/**
 * Один розбір параметрів для списку, лічильника, карток і CSV — щоб усі
 * четверо описували ті самі дзвінки.
 */
describe('callsFilterFromQuery', () => {
  const may = { numbers: true };

  it('passes the long-standing params through as they were', () => {
    expect(
      callsFilterFromQuery(
        {
          direction: 'inbound',
          status: 'completed',
          agentId: 'agent-1',
          number: '404',
          dateFrom: '2026-08-01',
          dateTo: '2026-08-05',
          origin: 'softphone',
          tagId: 't-spam',
        },
        may,
      ),
    ).toEqual({
      direction: 'inbound',
      status: 'completed',
      agentId: 'agent-1',
      number: '404',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-05',
      origin: 'softphone',
      tagId: 't-spam',
    });
  });

  it('keeps comma lists as the wire spelled them — the repository splits them', () => {
    const f = callsFilterFromQuery({ status: 'missed,busy', agentId: 'u1,u2', tagId: 't1,t2', flowId: 'f1,f2', sourceId: 's1' }, may);

    expect(f).toMatchObject({ status: 'missed,busy', agentId: 'u1,u2', tagId: 't1,t2', flowId: 'f1,f2', sourceId: 's1' });
  });

  it('a blank param is no filter', () => {
    const f = callsFilterFromQuery({ tagId: '', status: '  ', flowId: '' }, may);

    expect(f.tagId).toBeUndefined();
    expect(f.status).toBeUndefined();
    expect(f.flowId).toBeUndefined();
  });

  it('splits a client’s phone list and caps it', () => {
    const many = Array.from({ length: 30 }, (_, i) => `+1555000${String(i).padStart(4, '0')}`).join(',');

    expect(callsFilterFromQuery({ numbers: ' +1404 , ,+1541 ' }, may).numbers).toEqual(['+1404', '+1541']);
    expect(callsFilterFromQuery({ numbers: many }, may).numbers).toHaveLength(20);
  });

  it('reads the duration bounds as whole seconds', () => {
    expect(callsFilterFromQuery({ minDuration: '61', maxDuration: '179' }, may)).toMatchObject({ minDuration: 61, maxDuration: 179 });
  });

  it.each(['abc', '-1', '1.5'])('refuses a duration bound that is not whole seconds: %s', (bad) => {
    expect(() => callsFilterFromQuery({ minDuration: bad }, may)).toThrow(BadRequestException);
    expect(() => callsFilterFromQuery({ maxDuration: bad }, may)).toThrow(BadRequestException);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
  ])('reads masked / hasJob %s as %s', (raw, value) => {
    expect(callsFilterFromQuery({ masked: raw, hasJob: raw }, may)).toMatchObject({ masked: value, hasJob: value });
  });

  it('refuses a yes/no it cannot read', () => {
    expect(() => callsFilterFromQuery({ masked: 'maybe' }, may)).toThrow(BadRequestException);
  });

  it('ignores the paging params', () => {
    const f = callsFilterFromQuery({ cursor: 'c', limit: '10' } as never, may);

    expect(f).not.toHaveProperty('cursor');
    expect(f).not.toHaveProperty('limit');
  });
});
