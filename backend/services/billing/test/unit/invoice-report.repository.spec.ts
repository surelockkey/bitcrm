import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InvoiceReportRepository } from 'src/invoices/report/invoice-report.repository';

/** The walk of the whole invoice list: window as the key, the rest as ONE filter the count shares. */
describe('InvoiceReportRepository', () => {
  const repo = new InvoiceReportRepository({ client: { send: jest.fn() } } as never);
  const TODAY = '2026-09-29';

  it('keys a created window on New York instants, upper end exclusive', () => {
    const q = repo.buildQuery({ fromIso: '2026-09-01T04:00:00.000Z', toIso: '2026-09-28T04:00:00.000Z' }, TODAY);
    expect(q.IndexName).toBe('ListIndex');
    expect(q.KeyConditionExpression).toBe('GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to');
    expect(q.ExpressionAttributeValues).toMatchObject({ ':from': '2026-09-01T04:00:00.000Z', ':to': '2026-09-28T04:00:00.000Z' });
    expect(q.FilterExpression).toBeUndefined();
    expect(q.ScanIndexForward).toBe(false);
  });

  it('turns the Status group into one OR, Sent into an existence test', () => {
    const q = repo.buildQuery({ statuses: ['paid', 'overdue'], sent: ['unsent'] }, TODAY);
    expect(q.FilterExpression).toBe(
      '(#st = :paid OR ((#st IN (:due, :ovd) AND #tot.#bal > :zero) AND #dd < :today)) AND attribute_not_exists(#sent)',
    );
    expect(q.ExpressionAttributeValues).toMatchObject({ ':today': TODAY, ':paid': 'paid' });
  });

  it('asks nothing of Sent when both options are picked, and searches number or name', () => {
    const q = repo.buildQuery({ sent: ['sent', 'unsent'], search: 'ztn' }, TODAY);
    expect(q.FilterExpression).toBe('(contains(#num, :qu) OR contains(#num, :q) OR contains(#wn, :q))');
    expect(q.ExpressionAttributeValues).toMatchObject({ ':qu': 'ZTN', ':q': 'ztn' });
  });

  it('fills a page through the filter and hands back an exact cursor', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Items: [{ id: 'a', PK: 'INVOICE#a', GSI1PK: 'INVOICES' }], LastEvaluatedKey: { PK: 'INVOICE#a' } })
      .mockResolvedValueOnce({ Items: [{ id: 'b' }], LastEvaluatedKey: { PK: 'INVOICE#b' } });
    const r = new InvoiceReportRepository({ client: { send } } as never);
    const page = await r.page({ statuses: ['paid'] }, TODAY, 2);
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page.nextCursor).toBeDefined();
    expect((send.mock.calls[1][0] as QueryCommand).input.Limit).toBe(1);
  });

  it('counts with the same query, Select COUNT', async () => {
    const send = jest.fn().mockResolvedValue({ Count: 7 });
    const r = new InvoiceReportRepository({ client: { send } } as never);
    await expect(r.count({ statuses: ['paid'] }, TODAY)).resolves.toEqual({ total: 7, atLeast: false });
    expect((send.mock.calls[0][0] as QueryCommand).input).toMatchObject({ Select: 'COUNT', FilterExpression: '(#st = :paid)' });
  });
});
