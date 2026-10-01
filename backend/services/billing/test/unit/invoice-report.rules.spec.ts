import {
  agingBucketOf,
  agingDaysLate,
  invoiceDaysDueWindow,
  invoiceDiscountPercent,
  invoiceReportFigures,
  type Invoice,
} from '@bitcrm/types';
import {
  agingCards,
  agingCsvLine,
  agingRow,
  dayWindow,
  inWindow,
  invoiceCards,
  invoiceCsvLine,
  invoiceStatusText,
  isOpen as isOpenRule,
  matchesFilter,
  onlyOpen,
  sortAging,
} from 'src/invoices/report/invoice-report.rules';

const TODAY = '2026-09-29';

let n = 0;
const inv = (over: Partial<Invoice> & { balance?: number; paid?: number; total?: number } = {}): Invoice => {
  const { balance = 100, paid = 0, total = balance + paid, ...rest } = over;
  n++;
  return {
    id: `i-${n}`,
    number: `NUM${n}`,
    dealId: `i-${n}`,
    contactId: `c-${n}`,
    invoiceDate: '2026-09-01',
    paymentTerms: 'cash',
    dueDate: '2026-09-29',
    status: balance > 0 ? 'due' : 'paid',
    totals: {
      lineCount: 1,
      subtotal: total,
      taxableSubtotal: total,
      nonTaxableSubtotal: 0,
      discount: 0,
      taxableBase: total,
      taxRatePercent: 0,
      tax: 0,
      total,
      amountPaid: paid,
      balanceDue: balance,
    },
    version: 1,
    createdBy: 'u',
    createdAt: '2026-09-10T15:00:00.000Z',
    updatedAt: '2026-09-10T15:00:00.000Z',
    ...rest,
  } as Invoice;
};

describe('Days Late and the Aging buckets (Workiz, verified live 2026-09-29)', () => {
  it('counts whole days from the due date and never goes below zero', () => {
    expect(agingDaysLate('2026-09-28', TODAY)).toBe(1);
    expect(agingDaysLate('2019-07-16', TODAY)).toBe(2632); // 1MHIJW, the oldest on the live screen
    expect(agingDaysLate('2026-10-15', TODAY)).toBe(0);
    expect(agingDaysLate(TODAY, TODAY)).toBe(0);
  });

  it('cuts the buckets at [1,30) [30,60) [60,90) [90,∞) — 30 days late is "30-60"', () => {
    expect(agingBucketOf(0)).toBeNull();
    expect(agingBucketOf(1)).toBe('under30');
    expect(agingBucketOf(29)).toBe('under30');
    expect(agingBucketOf(30)).toBe('from30to60');
    expect(agingBucketOf(59)).toBe('from30to60');
    expect(agingBucketOf(60)).toBe('from60to90');
    expect(agingBucketOf(89)).toBe('from60to90');
    expect(agingBucketOf(90)).toBe('over90');
  });

  it('makes the first card EVERY unpaid invoice, the not-yet-due ones included', () => {
    const open = [
      inv({ dueDate: '2026-10-05', balance: 10 }), // not due yet
      inv({ dueDate: '2026-09-29', balance: 20 }), // due today — 0 days late
      inv({ dueDate: '2026-09-20', balance: 30.1 }), // 9
      inv({ dueDate: '2026-08-30', balance: 40.2 }), // 30
      inv({ dueDate: '2026-07-31', balance: 50 }), // 60
      inv({ dueDate: '2019-07-16', balance: 120 }), // 2632
    ];
    const cards = agingCards(open, TODAY);
    expect(cards.all).toEqual({ count: 6, amount: 270.3 });
    expect(cards.under30).toEqual({ count: 1, amount: 30.1 });
    expect(cards.from30to60).toEqual({ count: 1, amount: 40.2 });
    expect(cards.from60to90).toEqual({ count: 1, amount: 50 });
    expect(cards.over90).toEqual({ count: 1, amount: 120 });
  });

  it('sorts oldest debt first by default, any column on request', () => {
    const rows = [
      agingRow(inv({ dueDate: '2026-09-20', balance: 5 }), TODAY),
      agingRow(inv({ dueDate: '2019-07-16', balance: 1 }), TODAY),
      agingRow(inv({ dueDate: '2026-10-01', balance: 9 }), TODAY),
    ];
    expect(sortAging(rows).map((r) => r.daysLate)).toEqual([2632, 9, 0]);
    expect(sortAging(rows, 'balance', 'desc').map((r) => r.balance)).toEqual([9, 5, 1]);
    expect(sortAging(rows, 'dueDate', 'asc').map((r) => r.dueDate)).toEqual(['2019-07-16', '2026-09-20', '2026-10-01']);
  });

  it('writes Workiz’s CSV row: raw dates, "Days By"', () => {
    const r = { ...agingRow(inv({ dueDate: '2026-09-13', createdAt: '2026-07-15T22:42:42.000Z', balance: 12.5, total: 20 }), TODAY), clientName: 'Doe, Jane' };
    expect(agingCsvLine(r)).toBe(`${r.number},,"Doe, Jane",20.00,12.50,2026-09-13 00:00:00,2026-07-15 18:42:42,16`);
  });
});

describe('Workiz’s cent rule: owing $0.01 or less is paid', () => {
  it('keeps such an invoice out of Aging and the cards, and lists it as Paid', () => {
    const cent = inv({ balance: 0.01, paid: 123.6, dueDate: '2019-01-01' });
    const real = inv({ balance: 0.02, paid: 10, dueDate: '2019-01-01' });
    expect(isOpenRule(cent)).toBe(false);
    expect(agingCards([cent, real].filter(isOpenRule), TODAY).all).toEqual({ count: 1, amount: 0.02 });
    expect(matchesFilter(cent, { statuses: ['paid'] }, TODAY)).toBe(true);
    expect(matchesFilter(cent, { statuses: ['due'] }, TODAY)).toBe(false);
    expect(matchesFilter(cent, { daysDue: ['over_120'] }, TODAY)).toBe(false);
    expect(invoiceCards([cent, real], {}, TODAY).due).toEqual({ count: 1, amount: 0.02 });
  });

  it('shows Workiz’s figures: Subtotal without the card fee, Amount with the tip, Due $0.00 and Paid within a cent', () => {
    const i = inv({ balance: 0.01, paid: 90, total: 90.01 });
    i.totals = { ...i.totals, subtotal: 82.55, tax: 5.08, total: 87.63, amountPaid: 87.62, balanceDue: 0.01 };
    expect(invoiceReportFigures(i, { tip: 12.37, serviceFee: 2.55 })).toEqual({
      subtotal: 80, tax: 5.08, amount: 100, balance: 0, status: 'paid', tip: 12.37, serviceFee: 2.55,
    });
    expect(invoiceCsvLine(i, undefined, undefined, invoiceReportFigures(i, { tip: 12.37, serviceFee: 2.55 }))).toContain(',80.00,,5.08,100.00,0.00,Paid - Not sent,');
  });
});

describe('The Invoices cards', () => {
  it('windows on New York days, not UTC ones', () => {
    const w = dayWindow('2026-09-01', '2026-09-27');
    expect(w).toEqual({ fromIso: '2026-09-01T04:00:00.000Z', toIso: '2026-09-28T04:00:00.000Z' });
    expect(inWindow('2026-09-28T03:59:59.000Z', w)).toBe(true); // 23:59 on the 27th in New York
    expect(inWindow('2026-09-28T04:00:00.000Z', w)).toBe(false);
    expect(inWindow('2026-09-01T03:59:00.000Z', w)).toBe(false);
  });

  it('Due = every unpaid one created in the window, Overdue = past due today, Unsent = never sent', () => {
    const open = [
      inv({ dueDate: '2026-09-01', balance: 10, sentAt: '2026-09-01T00:00:00.000Z' }),
      inv({ dueDate: '2026-10-01', balance: 20 }),
      inv({ dueDate: '2026-09-01', balance: 30, createdAt: '2026-08-01T00:00:00.000Z' }), // outside
    ];
    const cards = invoiceCards(open, dayWindow('2026-09-01', '2026-09-27'), TODAY);
    expect(cards).toEqual({ due: { count: 2, amount: 30 }, overdue: { count: 1, amount: 10 }, unsent: { count: 1 } });
    expect(invoiceCards(open, {}, TODAY).due).toEqual({ count: 3, amount: 60 });
  });
});

describe('Filter results', () => {
  it('Due is every unpaid invoice; Overdue and Partially paid are parts of it; Paid is paid', () => {
    const partly = inv({ balance: 40, paid: 60, dueDate: '2026-09-01' });
    const fresh = inv({ balance: 10, dueDate: '2026-10-10' });
    const paid = inv({ balance: 0, paid: 100 });
    const f = (statuses: never[]) => [partly, fresh, paid].filter((i) => matchesFilter(i, { statuses }, TODAY)).map((i) => i.id);
    expect(f(['due'] as never[])).toEqual([partly.id, fresh.id]);
    expect(f(['overdue'] as never[])).toEqual([partly.id]);
    expect(f(['partially_paid'] as never[])).toEqual([partly.id]);
    expect(f(['paid'] as never[])).toEqual([paid.id]);
    expect(f(['paid', 'overdue'] as never[])).toEqual([partly.id, paid.id]);
  });

  it('Days due windows the due date the way Workiz sends it, on unpaid invoices only', () => {
    expect(invoiceDaysDueWindow('0_30', TODAY)).toEqual({ from: '2026-08-30', to: TODAY });
    expect(invoiceDaysDueWindow('30_60', TODAY)).toEqual({ from: '2026-07-31', to: '2026-08-30' });
    expect(invoiceDaysDueWindow('over_120', TODAY)).toEqual({ to: '2026-06-01' });
    const late = inv({ dueDate: '2026-08-15', balance: 5 });
    const settled = inv({ dueDate: '2026-08-15', balance: 0, paid: 5 });
    expect(matchesFilter(late, { daysDue: ['30_60'] }, TODAY)).toBe(true);
    expect(matchesFilter(settled, { daysDue: ['30_60'] }, TODAY)).toBe(false);
  });

  it('knows which filters UnpaidIndex can answer alone', () => {
    expect(onlyOpen({})).toBe(false);
    expect(onlyOpen({ statuses: ['due', 'overdue'] })).toBe(true);
    expect(onlyOpen({ statuses: ['paid', 'due'] })).toBe(false);
    expect(onlyOpen({ daysDue: ['0_30'] })).toBe(true);
  });

  it('Sent / Unsent, and search by number or name', () => {
    const sent = inv({ sentAt: '2026-09-02T00:00:00.000Z', number: 'ZTNRKF' });
    const unsent = inv({ workizName: 'Front door' });
    expect(matchesFilter(sent, { sent: ['unsent'] }, TODAY)).toBe(false);
    expect(matchesFilter(unsent, { sent: ['unsent'] }, TODAY)).toBe(true);
    expect(matchesFilter(sent, { sent: ['sent', 'unsent'] }, TODAY)).toBe(true);
    expect(matchesFilter(sent, { search: 'tnr' }, TODAY)).toBe(true);
    expect(matchesFilter(unsent, { search: 'front' }, TODAY)).toBe(true);
    expect(matchesFilter(unsent, { search: 'back' }, TODAY)).toBe(false);
  });
});

describe('The Invoices CSV', () => {
  it('writes the status the way the table stacks it', () => {
    expect(invoiceStatusText({ status: 'paid', sentAt: '2026-09-29T16:00:00.000Z' })).toBe('Paid - sent on Tue Sep 29, 2026');
    expect(invoiceStatusText({ status: 'overdue' })).toBe('Overdue - Not sent');
  });

  it('follows Workiz’s columns: Email, an empty Discount, Tax after it', () => {
    const i = inv({ number: 'GYL5H5', createdAt: '2026-09-29T02:00:00.000Z', balance: 0, paid: 547.7, total: 547.7 });
    i.totals = { ...i.totals, subtotal: 500, tax: 31.75, total: 547.7 };
    expect(invoiceCsvLine(i, { name: 'Russ Boyarsky', email: 'r@x.com' })).toBe(
      'GYL5H5,,Russ Boyarsky,r@x.com,2026-09-28,500.00,,31.75,547.70,0.00,Paid - Not sent,GYL5H5,',
    );
  });

  it('shows the discount as a percent of the subtotal', () => {
    expect(invoiceDiscountPercent({ subtotal: 200, discount: 20 })).toBe(10);
    expect(invoiceDiscountPercent({ subtotal: 0, discount: 0 })).toBe(0);
  });
});
