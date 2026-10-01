import { JobSuperStatus, type ItemsReportRow } from '@bitcrm/types';
import {
  aggregate,
  isCounted,
  itemsCsv,
  jobsOfItem,
  lineType,
  matchesItemFilters,
  matchesItemSearch,
  productFacts,
  round2,
  sortItemRows,
  toItemLine,
  toItemsDeal,
  type ItemLine,
  type ProductFacts,
  type WindowLine,
} from 'src/deals/report/items-report.logic';

/** A Done job as the Workiz import writes it (a subset of its attributes). */
const dealRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  PK: 'DEAL#d1',
  SK: 'METADATA',
  id: 'd1',
  status: 'active',
  dealNumber: 'NII265',
  jobSerial: 372833,
  contactId: 'c1',
  clientCompanyName: 'Austin State Supported Living Center',
  jobTypeId: 'jt1',
  createdAt: '2026-09-20T10:00:00.000Z',
  scheduledDate: '2026-09-24',
  scheduledEndDate: '2026-09-24',
  scheduledTimeSlot: '14:00-16:00',
  allDay: false,
  jobTimezone: 'America/Chicago',
  jobDateUtc: '2026-09-24T19:00:00.000Z',
  superStatus: 'done',
  assignedTechIds: ['u-tech'],
  hasServicePlan: false,
  ...over,
});

/** An imported line (`DEAL#…/PRODUCT#…`) as the generator writes it. */
const lineRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  SK: 'PRODUCT#l1',
  lineId: 'l1',
  productId: 'p-17011',
  itemId: '17011',
  name: 'Heavy Duty Commercial Door Closer',
  itemName: 'Norton 410xTPH Door Closer with Hold Open Arm',
  type: 'product',
  quantity: 10,
  priceClient: 496.57,
  costCompany: 271,
  soldBy: 'u-seller',
  addedBy: 'u-seller',
  fulfillment: 'imported',
  serial: 'TPHdc (SLK-17011)',
  sku: 'TPHdc (SLK-17011)',
  ...over,
});

const product = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'p-17011',
  number: 17011,
  sku: 'TPHdc (SLK-17011)',
  workizSerial: 'TPHdc (SLK-17011)',
  name: 'Norton 410xTPH Door Closer with Hold Open Arm',
  category: 'Door Hardware',
  type: 'product',
  externalId: 'workiz:item:17011',
  ...over,
});

const entry = (line: Record<string, unknown>, deal: Record<string, unknown> = {}): WindowLine => ({
  deal: toItemsDeal(dealRow(deal)),
  line: toItemLine(lineRow(line)) as ItemLine,
});

describe('round2', () => {
  it('rounds halves away from zero, without binary noise', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(6597.849999999999)).toBe(6597.85);
    expect(round2(0)).toBe(0);
  });
});

describe('toItemsDeal / isCounted', () => {
  it('reports a job on its job date, on the account clock', () => {
    const d = toItemsDeal(dealRow());
    expect(d.jobDate).toBe('2026-09-24T15:00');
    expect(isCounted(d, '2026-09-01', '2026-09-27')).toBe(true);
    expect(isCounted(d, '2026-09-25', '2026-09-27')).toBe(false);
  });

  it('counts Done jobs only, never an estimate stub', () => {
    for (const s of ['submitted', 'pending', 'in_progress', 'canceled', 'done_pending_approval']) {
      expect(isCounted(toItemsDeal(dealRow({ superStatus: s })), '2026-09-01', '2026-09-30')).toBe(false);
    }
    expect(isCounted(toItemsDeal(dealRow({ isStub: true })), '2026-09-01', '2026-09-30')).toBe(false);
  });

  it('a late Central visit is on the next Eastern day, as Workiz prints it', () => {
    const d = toItemsDeal(dealRow({ scheduledDate: '2026-09-27', scheduledTimeSlot: '23:30-23:59', jobDateUtc: '2026-09-28T04:30:00.000Z' }));
    expect(d.jobDate).toBe('2026-09-28T00:30');
    expect(isCounted(d, '2026-09-01', '2026-09-27')).toBe(false);
  });

  it('a BitCRM job without imported instants reports on its own date and slot', () => {
    const d = toItemsDeal(dealRow({ jobDateUtc: undefined, jobTimezone: undefined, scheduledTimeSlot: '09:00-10:00' }));
    expect(d.jobDate).toBe('2026-09-24T09:00');
  });

  it('takes the per-job client name, the company and the service plan flag', () => {
    const d = toItemsDeal(dealRow({ clientName: { firstName: 'Ronda', lastName: 'Cook' }, hasServicePlan: true }));
    expect(d.clientName).toBe('Ronda Cook');
    expect(d.clientCompany).toBe('Austin State Supported Living Center');
    expect(d.servicePlan).toBe(true);
  });
});

describe('toItemLine', () => {
  it('keeps the imported words: catalog name, Workiz item id, type, serial, seller', () => {
    const l = toItemLine(lineRow())!;
    expect(l).toMatchObject({
      key: 'p-17011',
      itemNumber: 17011,
      name: 'Norton 410xTPH Door Closer with Hold Open Arm',
      type: 'product',
      model: 'TPHdc (SLK-17011)',
      quantity: 10,
      price: 496.57,
      cost: 271,
      soldBy: 'u-seller',
    });
  });

  it('drops the service fee and discount lines — Workiz never counts them', () => {
    expect(toItemLine(lineRow({ type: 'SERVICE_FEE_TYPE', itemId: '10968', discountable: false }))).toBeNull();
    expect(toItemLine(lineRow({ type: 'DISCOUNT_TYPE' }))).toBeNull();
  });

  it('keeps a fractional quantity as is (3.1 hours)', () => {
    expect(toItemLine(lineRow({ quantity: 3.1 }))!.quantity).toBe(3.1);
  });

  it('a BitCRM line: no Workiz words, the adder is the seller, the fulfillment implies the type', () => {
    const l = toItemLine({
      SK: 'PRODUCT#x',
      lineId: 'x',
      productId: 'p-new',
      name: 'Deadbolt',
      sku: 'KW-780',
      quantity: 2,
      priceClient: 50,
      costCompany: 20,
      addedBy: 'u-tech',
      fulfillment: 'sourced',
    })!;
    expect(l).toMatchObject({ key: 'p-new', type: '', fallbackType: 'product', model: 'KW-780', soldBy: 'u-tech' });
    expect(l.itemNumber).toBeUndefined();
  });

  it('never names the importer as a seller, nor reads its WZ- stand-in SKU as a model', () => {
    const l = toItemLine(lineRow({ soldBy: undefined, addedBy: 'workiz-import', serial: undefined, sku: 'WZ-13652' }))!;
    expect(l.soldBy).toBeUndefined();
    expect(l.model).toBeUndefined();
  });

  it('a line with no product still gets a row of its own', () => {
    expect(toItemLine(lineRow({ productId: undefined }))!.key).toBe('item:17011');
    expect(toItemLine(lineRow({ productId: undefined, itemId: undefined }))!.key).toBe('name:norton 410xtph door closer with hold open arm');
  });
});

describe('productFacts', () => {
  it('prints the price book: current name, number, Workiz serial, category', () => {
    expect(productFacts(product())).toEqual({
      id: 'p-17011',
      number: 17011,
      name: 'Norton 410xTPH Door Closer with Hold Open Arm',
      type: 'product',
      model: 'TPHdc (SLK-17011)',
      category: 'Door Hardware',
    });
  });

  it('Workiz other / hours win over the stored service; Uncategorized is blank; WZ- is no model', () => {
    const f = productFacts(product({ type: 'service', workizType: 'other', category: 'Uncategorized', workizSerial: undefined, sku: 'WZ-9588' }));
    expect(f.type).toBe('other');
    expect(f.category).toBeUndefined();
    expect(f.model).toBeUndefined();
  });

  it("a BitCRM product's SKU is its model #, even one that starts with WZ-", () => {
    expect(productFacts(product({ externalId: undefined, workizSerial: undefined, sku: 'WZ-1' })).model).toBe('WZ-1');
  });
});

describe('matchesItemFilters', () => {
  const facts = productFacts(product());

  it('OR inside a group, AND between groups', () => {
    const e = entry({});
    expect(matchesItemFilters(e, facts, {})).toBe(true);
    expect(matchesItemFilters(e, facts, { type: ['service', 'product'] })).toBe(true);
    expect(matchesItemFilters(e, facts, { type: ['service'] })).toBe(false);
    expect(matchesItemFilters(e, facts, { type: ['product'], jobTypeId: ['jt2'] })).toBe(false);
    expect(matchesItemFilters(e, facts, { jobTypeId: ['jt1'], soldBy: ['u-seller'] })).toBe(true);
    expect(matchesItemFilters(e, facts, { soldBy: ['someone'] })).toBe(false);
    expect(matchesItemFilters(e, facts, { category: ['door hardware'] })).toBe(true);
    expect(matchesItemFilters(e, facts, { category: ['Safes'] })).toBe(false);
  });

  it("Workiz's Expense filter does not catch an `other` item — as there", () => {
    const e = entry({ type: 'other' });
    expect(matchesItemFilters(e, undefined, { type: ['expense'] })).toBe(false);
    expect(matchesItemFilters(e, undefined, { type: ['product', 'service', 'hours', 'expense', 'equipment', 'warranty'] })).toBe(false);
  });

  it("a BitCRM line takes the price book's type, then its fulfillment's", () => {
    const line = toItemLine({ productId: 'p-h', quantity: 1, priceClient: 1, costCompany: 0, fulfillment: 'service' })!;
    const hours: ProductFacts = { id: 'p-h', name: 'Hour', type: 'hours' };
    expect(lineType(line, hours)).toBe('hours');
    expect(lineType(line, undefined)).toBe('service');
  });

  it('an uncategorized item never matches a category', () => {
    expect(matchesItemFilters(entry({}), productFacts(product({ category: 'Uncategorized' })), { category: ['Uncategorized'] })).toBe(false);
  });
});

describe('aggregate', () => {
  const products = new Map([['p-17011', productFacts(product())]]);

  it("Workiz's row: Σ qty, Σ qty×price, Σ qty×cost, profit and margin (Norton 410xTPH, checked live)", () => {
    const { rows, totals } = aggregate([entry({})], products, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'p-17011',
      number: 17011,
      name: 'Norton 410xTPH Door Closer with Hold Open Arm',
      type: 'product',
      model: 'TPHdc (SLK-17011)',
      category: 'Door Hardware',
      units: 10,
      price: 4965.7,
      cost: 2710,
      profit: 2255.7,
      margin: 45.43,
      jobs: 1,
      servicePlan: false,
    });
    expect(totals).toEqual({ items: 1, units: 10, price: 4965.7, cost: 2710, profit: 2255.7, margin: 45.43 });
  });

  it('one row per item, jobs counted once however many lines a job holds', () => {
    const labor = { productId: 'p-9588', itemId: '9588', itemName: 'Labor', type: 'service', priceClient: 79, costCompany: 0, serial: undefined };
    const { rows, totals } = aggregate(
      [
        entry({ ...labor, quantity: 1 }),
        entry({ ...labor, quantity: 3.1 }),
        entry({ ...labor, quantity: 2 }, { id: 'd2' }),
        entry({}, { id: 'd2' }),
      ],
      products,
      true,
    );
    const laborRow = rows.find((r) => r.key === 'p-9588')!;
    expect(laborRow).toMatchObject({ units: 6.1, price: 481.9, cost: 0, profit: 481.9, margin: 100, jobs: 2, name: 'Labor', number: 9588 });
    expect(totals.items).toBe(2);
    expect(totals.units).toBe(16.1);
    expect(totals.price).toBe(5447.6);
  });

  it('a zero price is a zero margin; a loss is a negative profit', () => {
    const { rows } = aggregate([entry({ priceClient: 0, costCompany: 11.42, quantity: 1 })], products, true);
    expect(rows[0]).toMatchObject({ price: 0, cost: 11.42, profit: -11.42, margin: 0 });
  });

  it('the Total row sums the unrounded lines', () => {
    const lines = [0.005, 0.005, 0.005].map((p, i) => entry({ productId: `p${i}`, priceClient: p, costCompany: 0, quantity: 1 }));
    const { rows, totals } = aggregate(lines, new Map(), true);
    expect(rows.map((r) => r.price)).toEqual([0.01, 0.01, 0.01]);
    expect(totals.price).toBe(0.02);
  });

  it('without the money grant nothing about money leaves', () => {
    const { rows, totals } = aggregate([entry({})], products, false);
    expect(rows[0].price).toBeUndefined();
    expect(rows[0].cost).toBeUndefined();
    expect(rows[0].profit).toBeUndefined();
    expect(rows[0].margin).toBeUndefined();
    expect(totals).toEqual({ items: 1, units: 10 });
  });

  it("without the price book the line's own words print", () => {
    const { rows } = aggregate([entry({})], new Map(), true);
    expect(rows[0]).toMatchObject({ number: 17011, name: 'Norton 410xTPH Door Closer with Hold Open Arm', model: 'TPHdc (SLK-17011)', type: 'product' });
    expect(rows[0].category).toBeUndefined();
  });

  it('marks an item sold on a job under a service plan', () => {
    const { rows } = aggregate([entry({}, { hasServicePlan: true })], products, true);
    expect(rows[0].servicePlan).toBe(true);
  });
});

describe('search and sort', () => {
  const row = (over: Partial<ItemsReportRow>): ItemsReportRow => ({
    key: 'k',
    name: 'x',
    type: 'product',
    units: 0,
    jobs: 0,
    servicePlan: false,
    ...over,
  });
  const rows = [
    row({ key: 'a', number: 10897, name: 'Service Call', units: 983.5, price: 111704.76, jobs: 555 }),
    row({ key: 'b', number: 10455, name: 'Lock Install', units: 1382, price: 99399.96, jobs: 23, model: 'LI-1' }),
    row({ key: 'c', name: 'Unknown item', units: 1, price: 5, jobs: 1 }),
    row({ key: 'd', number: 17011, name: 'Norton 410xTPH', units: 10, price: 4965.7, jobs: 1, category: 'Door Hardware' }),
  ];

  it("default: Workiz's item_id desc, newest items first; a row without a number last", () => {
    expect(sortItemRows(rows, 'number', 'desc').map((r) => r.key)).toEqual(['d', 'a', 'b', 'c']);
    expect(sortItemRows(rows, 'number', 'asc').map((r) => r.key)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('sorts on any column', () => {
    expect(sortItemRows(rows, 'units', 'desc').map((r) => r.key)).toEqual(['b', 'a', 'd', 'c']);
    expect(sortItemRows(rows, 'price', 'desc')[0].key).toBe('a');
    expect(sortItemRows(rows, 'item', 'asc').map((r) => r.key)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortItemRows(rows, 'category', 'asc')[0].key).toBe('d');
  });

  it('searches the name, the model # and the item number', () => {
    expect(rows.filter((r) => matchesItemSearch(r, 'lock')).map((r) => r.key)).toEqual(['b']);
    expect(rows.filter((r) => matchesItemSearch(r, 'li-1')).map((r) => r.key)).toEqual(['b']);
    expect(rows.filter((r) => matchesItemSearch(r, '#10897')).map((r) => r.key)).toEqual(['a']);
    expect(rows.filter((r) => matchesItemSearch(r, '')).length).toBe(4);
  });
});

describe('jobsOfItem', () => {
  it("one row per job, the item's lines merged, the newest job first", () => {
    const labor = { productId: 'p-9588', itemId: '9588', type: 'service', priceClient: 79, costCompany: 0 };
    const rows = jobsOfItem(
      [
        entry({ ...labor, quantity: 1 }),
        entry({ ...labor, quantity: 3.1, soldBy: 'u-2' }),
        entry({ ...labor, quantity: 2 }, { id: 'd2', dealNumber: 'ABC', jobSerial: 1, jobDateUtc: '2026-09-25T14:00:00.000Z', scheduledDate: '2026-09-25' }),
        entry({}),
      ],
      'p-9588',
      true,
    );
    expect(rows.map((r) => r.dealId)).toEqual(['d2', 'd1']);
    expect(rows[1]).toMatchObject({
      jobNumber: 'NII265',
      jobSerial: 372833,
      jobDate: '2026-09-24T15:00',
      clientCompany: 'Austin State Supported Living Center',
      units: 4.1,
      price: 323.9,
      cost: 0,
      profit: 323.9,
      margin: 100,
      soldByIds: ['u-seller', 'u-2'],
    });
  });

  it('keeps money out without the grant', () => {
    const [r] = jobsOfItem([entry({})], 'p-17011', false);
    expect(r.price).toBeUndefined();
    expect(r.units).toBe(10);
  });
});

describe('itemsCsv', () => {
  const { rows, totals } = aggregate([entry({ itemName: '=cmd', name: '=cmd' })], new Map(), true);

  it("Workiz's columns, Totals first, formulas defused", () => {
    const csv = itemsCsv(rows, totals, true).split('\r\n');
    expect(csv[0]).toBe('Item,SKU,Units,Category,Price,Cost,Profit,Jobs,Service Plan');
    expect(csv[1]).toBe('Totals,,10.00,,4965.70,2710.00,2255.70,,');
    expect(csv[2]).toBe("'=cmd,TPHdc (SLK-17011),10.00,,4965.70,2710.00,2255.70,1,No");
    expect(csv[3]).toBe('');
  });

  it('drops the money columns without the grant', () => {
    const csv = itemsCsv(aggregate([entry({})], new Map(), false).rows, { items: 1, units: 10 }, false).split('\r\n');
    expect(csv[0]).toBe('Item,SKU,Units,Category,Jobs,Service Plan');
    expect(csv[1]).toBe('Totals,,10.00,,,');
  });
});

describe('the fixtures', () => {
  it('describe a Done job', () => {
    expect(toItemsDeal(dealRow()).superStatus).toBe(JobSuperStatus.DONE);
  });
});
