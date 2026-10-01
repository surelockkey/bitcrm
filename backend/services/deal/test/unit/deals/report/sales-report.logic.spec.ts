import { JobSuperStatus, type SalesReportRow } from '@bitcrm/types';
import { emptyLookups } from 'src/deals/report/jobs-report.logic';
import {
  isSale,
  marginOf,
  matchesSalesFilters,
  matchesSalesSearch,
  paymentStatusOf,
  salesByDay,
  salesCellText,
  salesCsvHeader,
  salesCsvLine,
  salesCsvTotalsLine,
  salesMoney,
  salesOf,
  salesTotals,
  sortSalesRows,
  toSalesDeal,
  toSalesRow,
} from 'src/deals/report/sales-report.logic';

/** An imported job as the Workiz import writes it: Workiz's own figures, cost = company + tech parts in `totals`. */
const imported = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'd1',
  dealNumber: 'LKYZTX',
  jobSerial: 374554,
  contactId: 'c1',
  superStatus: 'done',
  createdAt: '2026-09-27T20:55:10.000Z',
  scheduledDate: '2026-09-27',
  scheduledTimeSlot: '12:15-15:57',
  jobDateUtc: '2026-09-27T19:15:00.000Z',
  jobEndDateUtc: '2026-09-27T22:57:54.000Z',
  jobTimezone: 'America/Phoenix',
  totals: { subtotal: 267, discount: 0, tax: 0, total: 267, cost: 34, tip: 0, amountDue: 0, amountPaid: 267, source: 'workiz' },
  jobTotalPrice: 267,
  subTotal: 267,
  taxAmount: 0,
  parts: 34,
  companyParts: 0,
  paidTotal: 267,
  ...over,
});

describe('salesMoney — Workiz\'s money of a job', () => {
  it('takes an imported job\'s own figures: Item cost = company parts, Tech expenses = tech parts', () => {
    expect(salesMoney(imported())).toEqual({
      total: 26700,
      subtotal: 26700,
      itemCost: 0,
      laborCost: 0,
      cardExpenses: 0,
      techExpenses: 3400,
      paid: 26700,
      due: 0,
      tax: 0,
      profit: 23300,
      tip: 0,
    });
  });

  it('Profit = Total − Tax − Item cost − Tech expenses − Labor − Card; the tip is not taken off', () => {
    const c = salesMoney(
      imported({
        totals: { subtotal: 150.12, tax: 9.53, total: 169.65, cost: 30, tip: 10, amountPaid: 0, source: 'workiz' },
        companyParts: 20,
        parts: 10,
        totalLabourCost: 5,
        cardExpenses: 1.5,
      }),
    );
    expect(c.profit).toBe(16965 - 953 - 2000 - 1000 - 500 - 150);
    expect(c.tip).toBe(1000);
  });

  it('Due = Total − Paid, below zero when the job is overpaid (Workiz\'s double-recorded payment)', () => {
    const c = salesMoney(imported({ totals: { total: 886.41, tax: 0, amountPaid: 1772.82, source: 'workiz' }, companyParts: 0, parts: 0 }));
    expect(c.due).toBe(-88641);
  });

  it('paid: billing\'s latest word first, then the snapshot, then the importer\'s copy', () => {
    expect(salesMoney(imported({ amountPaid: 100 })).paid).toBe(10000);
    expect(salesMoney(imported({ totals: { total: 267, amountPaid: 50 } })).paid).toBe(5000);
    expect(salesMoney(imported({ totals: { total: 267 }, paidTotal: 20 })).paid).toBe(2000);
  });

  it('a job made here: Item cost is its lines\' cost (totals.cost), no tech parts', () => {
    const c = salesMoney({ superStatus: 'done', totals: { subtotal: 100, discount: 0, tax: 6.35, total: 106.35, cost: 40 } });
    expect(c).toMatchObject({ total: 10635, subtotal: 10000, tax: 635, itemCost: 4000, techExpenses: 0, paid: 0, due: 10635, profit: 6000 });
  });

  it('an imported snapshot without companyParts: its cost less the tech parts', () => {
    const c = salesMoney(imported({ companyParts: undefined, parts: 34, totals: { total: 267, cost: 100, source: 'workiz' } }));
    expect(c.itemCost).toBe(6600);
  });

  it('falls back to the importer\'s flat fields when a row has no snapshot', () => {
    const c = salesMoney({ jobTotalPrice: 50, subTotal: 47, taxAmount: 3, tipAmount: 2 });
    expect(c).toMatchObject({ total: 5000, subtotal: 4700, tax: 300, tip: 200 });
  });
});

describe('which jobs are sales', () => {
  it('any status but Canceled, and a total above zero', () => {
    expect(isSale(toSalesDeal(imported()))).toBe(true);
    expect(isSale(toSalesDeal(imported({ superStatus: 'canceled' })))).toBe(false);
    expect(isSale(toSalesDeal(imported({ superStatus: 'pending' })))).toBe(true);
    // A Done job never priced is not a sale (Workiz leaves out 50 of them in 01–27.09).
    expect(isSale(toSalesDeal(imported({ totals: { total: 0 }, jobTotalPrice: 0 })))).toBe(false);
  });

  it('salesOf: the sales of the period on the chosen date, through the filters', () => {
    const deals = [
      toSalesDeal(imported({ id: 'in' })),
      toSalesDeal(imported({ id: 'canceled', superStatus: 'canceled' })),
      toSalesDeal(imported({ id: 'zero', totals: { total: 0 }, jobTotalPrice: 0 })),
      // 23:30 in Phoenix on the 27th is already the 28th in the account's Eastern calendar.
      toSalesDeal(imported({ id: 'late', jobDateUtc: '2026-09-28T06:30:00.000Z', jobEndDateUtc: '2026-09-28T07:00:00.000Z' })),
    ];
    expect(salesOf(deals, 'scheduled', '2026-09-01', '2026-09-27').map((d) => d.id)).toEqual(['in']);
    expect(salesOf(deals, 'scheduled', '2026-09-28', '2026-09-28').map((d) => d.id)).toEqual(['late']);
  });
});

describe('payment status and the filters', () => {
  it('Paid when nothing is due (overpaid too), Partly paid when some is paid and some due, else Due', () => {
    expect(paymentStatusOf({ paid: 100, due: 0 })).toBe('paid');
    expect(paymentStatusOf({ paid: 200, due: -100 })).toBe('paid');
    expect(paymentStatusOf({ paid: 52500, due: 1 })).toBe('partly_paid');
    expect(paymentStatusOf({ paid: 0, due: 100 })).toBe('due');
  });

  const deal = toSalesDeal(
    imported({ assignedTechIds: ['t1', 't2'], jobTypeId: 'jt', sourceId: 's', serviceAreaId: 'a', totals: { total: 100, amountPaid: 40 } }),
  );

  it('Team: the job counts whole for any technician on it', () => {
    expect(matchesSalesFilters(deal, { techId: ['t2'] })).toBe(true);
    expect(matchesSalesFilters(deal, { techId: ['t3'] })).toBe(false);
  });

  it('OR inside a group, AND between groups', () => {
    expect(matchesSalesFilters(deal, { status: ['pending', 'done'], jobTypeId: ['jt'] })).toBe(true);
    expect(matchesSalesFilters(deal, { status: ['done'], serviceAreaId: ['other'] })).toBe(false);
    expect(matchesSalesFilters(deal, { paymentStatus: ['partly_paid'], sourceId: ['s'] })).toBe(true);
    expect(matchesSalesFilters(deal, { paymentStatus: ['paid', 'due'] })).toBe(false);
  });

  it('a Workiz stub has no status: any status filter leaves it out', () => {
    const stub = toSalesDeal(imported({ isStub: true }));
    expect(matchesSalesFilters(stub, {})).toBe(true);
    expect(matchesSalesFilters(stub, { status: ['done'] })).toBe(false);
  });
});

describe('rows, Total and chart', () => {
  const lk = emptyLookups();
  lk.jobTypes.set('jt', 'House Lockout');
  lk.users.set('t1', '(3) AZ - Asaf');
  lk.clients.set('c1', 'Brian Sanford');

  it('a row: the job\'s columns from the Jobs report plus its money and margin', () => {
    const row = toSalesRow(toSalesDeal(imported({ jobTypeId: 'jt', assignedTechIds: ['t1'], invoiceId: 'd1' })), lk, { money: true, numbers: true });
    expect(row).toMatchObject({
      id: 'd1',
      jobNumber: 'LKYZTX',
      jobSerial: 374554,
      client: 'Brian Sanford',
      type: 'House Lockout',
      tech: ['(3) AZ - Asaf'],
      status: 'Done',
      invoiceId: 'd1',
      total: 267,
      itemCost: 0,
      techExpenses: 34,
      paid: 267,
      due: 0,
      profit: 233,
      margin: 87.27,
    });
    expect(row.scheduled).toBe('2026-09-27T15:15');
  });

  it('without financials.view no amount leaves the server', () => {
    const row = toSalesRow(toSalesDeal(imported()), lk, { money: false, numbers: true });
    for (const k of ['total', 'subtotal', 'itemCost', 'paid', 'due', 'profit', 'tip', 'tax', 'margin']) expect(row).not.toHaveProperty(k);
    expect(salesTotals([toSalesDeal(imported())], false)).toEqual({ jobs: 1 });
  });

  it('a stub\'s status prints empty, as in Workiz', () => {
    expect(toSalesRow(toSalesDeal(imported({ isStub: true })), lk, { money: true, numbers: true }).status).toBe('');
  });

  it('Total sums in cents — no float drift — and prints the margin', () => {
    const deals = Array.from({ length: 10 }, (_, i) =>
      toSalesDeal(imported({ id: `d${i}`, totals: { total: 0.1, tax: 0, amountPaid: 0.1, source: 'workiz' }, companyParts: 0, parts: 0 })),
    );
    const t = salesTotals(deals, true);
    expect(t).toMatchObject({ jobs: 10, total: 1, paid: 1, due: 0, profit: 1, margin: 100 });
  });

  it('margin: Profit / Total to two decimals, 0 without a total', () => {
    expect(marginOf(53204183, 66028362)).toBe(80.58);
    expect(marginOf(100, 0)).toBe(0);
  });

  it('chart: Σ Total and Σ Profit per day on the chosen date, every day of the period', () => {
    const deals = [
      toSalesDeal(imported({ id: 'a' })),
      toSalesDeal(imported({ id: 'b', totals: { total: 100, tax: 0, source: 'workiz' }, companyParts: 10, parts: 0 })),
    ];
    expect(salesByDay(deals, 'scheduled', '2026-09-26', '2026-09-28')).toEqual([
      { day: '2026-09-26', sales: 0, profit: 0 },
      { day: '2026-09-27', sales: 367, profit: 323 },
      { day: '2026-09-28', sales: 0, profit: 0 },
    ]);
    // By created, the same jobs are on the day they were created (16:55 Eastern on the 27th).
    expect(salesByDay(deals, 'created', '2026-09-27', '2026-09-27')[0].sales).toBe(367);
  });
});

const row = (over: Partial<SalesReportRow>): SalesReportRow => ({
  id: 'x',
  jobNumber: 'ABC123',
  contactId: 'c',
  client: '',
  createdAt: '2026-09-01T12:00:00.000Z',
  superStatus: JobSuperStatus.DONE,
  status: 'Done',
  type: '',
  techIds: [],
  tech: [],
  ...over,
});

describe('search', () => {
  const r = row({ jobNumber: 'RK1Q8O', jobSerial: 372282, client: 'Jerryel Guzman-Ortiz', email: 'jgortiz203@gmail.com', phone: '+14753139051' });

  it('finds the job number, its Workiz serial, the client and the email', () => {
    for (const q of ['rk1q8o', '372282', 'Guzman', 'gmail', '203']) expect(matchesSalesSearch(r, q)).toBe(true);
  });

  it('not the phone — Workiz finds nothing for a client\'s number', () => {
    expect(matchesSalesSearch(r, '4753139051')).toBe(false);
  });
});

describe('sort', () => {
  it('Job ID newest first: jobs made here (no Workiz serial) above imported ones, imported by serial', () => {
    const rows = [
      row({ id: 'old', jobSerial: 100 }),
      row({ id: 'native', createdAt: '2026-10-02T00:00:00.000Z' }),
      row({ id: 'new', jobSerial: 200 }),
      row({ id: 'native2', createdAt: '2026-10-03T00:00:00.000Z' }),
    ];
    expect(sortSalesRows(rows, 'jobNumber', 'desc').map((r) => r.id)).toEqual(['native2', 'native', 'new', 'old']);
    expect(sortSalesRows(rows, 'jobNumber', 'asc').map((r) => r.id)).toEqual(['old', 'new', 'native', 'native2']);
  });

  it('money numerically, text by its printed value', () => {
    const rows = [row({ id: 'a', total: 9, client: 'b' }), row({ id: 'b', total: 67291, client: 'A' }), row({ id: 'c', total: 100, client: 'c' })];
    expect(sortSalesRows(rows, 'total', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortSalesRows(rows, 'client', 'asc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('CSV', () => {
  const columns = ['jobNumber', 'client', 'scheduled', 'status', 'total', 'due', 'profit'] as const;
  const r = row({
    jobNumber: 'LKYZTX',
    client: 'Brian Sanford',
    email: 'b@x.com',
    scheduled: '2026-09-27T15:15',
    status: 'In Progress',
    subStatus: 'Job Accepted',
    total: 267,
    due: -886.41,
    profit: 233,
  });

  it('Workiz headers, then the Total row, then the jobs', () => {
    expect(salesCsvHeader(columns)).toBe('Job ID,Client,Scheduled,Status,Total,Due,Profit');
    expect(salesCsvTotalsLine({ jobs: 1, total: 267, due: -886.41, profit: 233 }, columns)).toBe('Total:,,,,267.00,-886.41,233.00');
    expect(salesCsvLine(r, columns)).toBe('LKYZTX,Brian Sanford (b@x.com),"Sun Sep 27, 2026 03:15 pm",In Progress - Job Accepted,267.00,-886.41,233.00');
  });

  it('an amount is never defused as a formula; a text cell is', () => {
    expect(salesCellText(r, 'due')).toBe('-886.41');
    expect(salesCsvLine(row({ jobNumber: '=cmd' }), ['jobNumber'])).toBe("'=cmd");
  });
});
