import { JobSuperStatus, JOBS_REPORT_DEFAULT_COLUMNS, type JobsReportRow } from '@bitcrm/types';
import {
  cellText,
  csvField,
  csvHeader,
  csvLine,
  emptyLookups,
  formatPhone,
  inWindow,
  matchesFilters,
  matchesSearch,
  paginate,
  sortRows,
  toReportDeal,
  toRow,
  workizDate,
  type ReportDeal,
} from 'src/deals/report/jobs-report.logic';

/** An imported row, shaped like the Workiz package (a subset of its attributes). */
const imported = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  PK: 'DEAL#d1',
  SK: 'METADATA',
  id: 'd1',
  status: 'active',
  dealNumber: '0XJH37',
  jobSerial: 366524,
  contactId: 'c1',
  tagIds: ['t1', 't2'],
  jobTypeId: 'jt1',
  createdAt: '2026-08-03T21:43:40.000Z',
  scheduledDate: '2026-09-24',
  scheduledEndDate: '2026-09-24',
  scheduledTimeSlot: '08:00-12:00',
  allDay: false,
  jobTimezone: 'America/Chicago',
  jobDateUtc: '2026-09-24T13:00:00.000Z',
  jobEndDateUtc: '2026-09-24T17:00:00.000Z',
  primaryPhone: '+14693386825',
  emailAddress: 'client@example.com',
  superStatus: 'done',
  subStatusId: 'ss1',
  assignedTechIds: ['u-tech'],
  createdBy: 'u-disp',
  userCreated: '(1) (Tess) 1 Dispatcher',
  address: { street: '531 W Munson St', city: 'Denison', state: 'Texas', zip: '75020', lat: 1, lng: 2 },
  serviceArea: 'SURE LOCK SHERMAN TX',
  serviceAreaId: 'sa1',
  totals: { subtotal: 644.76, discount: 0, tax: 53.19, total: 697.95, cost: 132.53, amountDue: 0, source: 'workiz' },
  estimatedTotal: 1,
  actualTotal: 2,
  jobTotalPrice: 697.95,
  jobAmountDue: 0,
  sourceId: 's1',
  ...over,
});

const lookups = () => {
  const lk = emptyLookups();
  lk.jobTypes.set('jt1', 'Car key');
  lk.sources.set('s1', 'SURE TX SHERMAN GMB');
  lk.tags.set('t1', { name: 'NEEDS A CALL', color: 'blue' as never });
  lk.tags.set('t2', { name: 'VIP' });
  lk.subStatuses.set('ss1', 'Paid');
  lk.serviceAreas.set('sa1', 'SURE LOCK SHERMAN TX');
  lk.externalCompanies.set('ec1', 'Partner Co');
  lk.users.set('u-tech', '(2) TX - Sam');
  lk.users.set('u-disp', 'Tess Dispatcher');
  lk.clients.set('c1', 'Kayleigh Brown');
  return lk;
};

const ALL = { money: true, numbers: true };

describe('Jobs report logic', () => {
  describe('toReportDeal', () => {
    it('keeps what the report shows, with dates on the Eastern clock', () => {
      const d = toReportDeal(imported());
      expect(d).toMatchObject({
        id: 'd1',
        jobNumber: '0XJH37',
        jobSerial: 366524,
        created: '2026-08-03T17:43',
        scheduled: '2026-09-24T09:00',
        end: '2026-09-24T13:00',
        phone: '+14693386825',
        superStatus: JobSuperStatus.DONE,
        street: '531 W Munson St',
        zip: '75020',
        origin: 'new',
      });
    });

    it('reads the money from totals.total — never actualTotal / estimatedTotal', () => {
      expect(toReportDeal(imported()).total).toBe(697.95);
      expect(toReportDeal(imported({ totals: undefined })).total).toBe(697.95);
      expect(toReportDeal(imported({ totals: undefined, jobTotalPrice: undefined })).total).toBe(0);
      expect(toReportDeal(imported({ totals: { total: 10 }, jobTotalPrice: 99 })).total).toBe(10);
    });

    it('marks a converted lead, takes the first of a native job phones, and the per-job client name', () => {
      const d = toReportDeal(
        imported({ converted: true, primaryPhone: undefined, phones: ['+12035551234'], clientName: { firstName: 'Ann', lastName: 'Lee' } }),
      );
      expect(d.origin).toBe('lead');
      expect(d.phone).toBe('+12035551234');
      expect(d.clientName).toBe('Ann Lee');
    });

    it('derives the super-status of a legacy row from its stage', () => {
      expect(toReportDeal(imported({ superStatus: undefined, stage: 'completed' })).superStatus).toBe(JobSuperStatus.DONE);
    });
  });

  describe('window and filters', () => {
    const d = toReportDeal(imported());

    it('windows on the chosen date, both ends included', () => {
      expect(inWindow(d, 'end', '2026-09-24', '2026-09-24')).toBe(true);
      expect(inWindow(d, 'end', '2026-09-25', '2026-09-30')).toBe(false);
      expect(inWindow(d, 'created', '2026-08-01', '2026-08-03')).toBe(true);
      expect(inWindow(d, 'scheduled', '2026-09-01', '2026-09-23')).toBe(false);
    });

    it('ORs inside a group and ANDs between groups', () => {
      expect(matchesFilters(d, {})).toBe(true);
      expect(matchesFilters(d, { status: ['canceled', 'done'] })).toBe(true);
      expect(matchesFilters(d, { status: ['done:ss1'] })).toBe(true);
      expect(matchesFilters(d, { status: ['done:other'] })).toBe(false);
      expect(matchesFilters(d, { status: ['done'], techId: ['nobody'] })).toBe(false);
      expect(matchesFilters(d, { techId: ['x', 'u-tech'], tagId: ['t9', 't2'] })).toBe(true);
      expect(matchesFilters(d, { origin: ['lead'] })).toBe(false);
      expect(matchesFilters(d, { origin: ['new'], createdBy: ['u-disp'], jobTypeId: ['jt1'] })).toBe(true);
      expect(matchesFilters(d, { sourceId: ['s1'], serviceAreaId: ['sa1'] })).toBe(true);
      expect(matchesFilters(d, { externalCompanyId: ['ec1'] })).toBe(false);
    });
  });

  describe('toRow', () => {
    it('names every id and prints the Workiz status with its sub-status', () => {
      const row = toRow(toReportDeal(imported()), lookups(), ALL);
      expect(row).toMatchObject({
        client: 'Kayleigh Brown',
        type: 'Car key',
        status: 'Done',
        subStatus: 'Paid',
        tech: ['(2) TX - Sam'],
        createdBy: 'Tess Dispatcher',
        serviceArea: 'SURE LOCK SHERMAN TX',
        source: 'SURE TX SHERMAN GMB',
        total: 697.95,
        phone: '+14693386825',
      });
      expect(row.tags.map((t) => t.name)).toEqual(['NEEDS A CALL', 'VIP']);
    });

    it('falls back to Workiz\'s own creator text when the user is unknown', () => {
      const lk = lookups();
      lk.users.delete('u-disp');
      expect(toRow(toReportDeal(imported()), lk, ALL).createdBy).toBe('(1) (Tess) 1 Dispatcher');
    });

    it('withholds money without financials.view and the number without contacts.view_numbers', () => {
      const row = toRow(toReportDeal(imported()), lookups(), { money: false, numbers: false });
      expect(row.total).toBeUndefined();
      expect(row.amountDue).toBeUndefined();
      expect(row.phone).toBeUndefined();
      expect(row.phoneMasked).toBe(true);
    });
  });

  describe('search, sort and paging', () => {
    const rows: JobsReportRow[] = [
      toRow(toReportDeal(imported({ id: 'a', dealNumber: 'AAA111', createdAt: '2026-09-01T10:00:00.000Z', contactId: 'c1' })), lookups(), ALL),
      toRow(toReportDeal(imported({ id: 'b', dealNumber: 'BBB222', createdAt: '2026-09-03T10:00:00.000Z', totals: { total: 5 } })), lookups(), ALL),
      toRow(toReportDeal(imported({ id: 'c', dealNumber: 'CCC333', createdAt: '2026-09-02T10:00:00.000Z', totals: { total: 50 }, address: { city: 'austin' } })), lookups(), ALL),
    ];

    it('finds a job by number, client, city or phone digits', () => {
      expect(matchesSearch(rows[1], 'bbb2')).toBe(true);
      expect(matchesSearch(rows[0], 'kayleigh')).toBe(true);
      expect(matchesSearch(rows[2], 'AUSTIN')).toBe(true);
      expect(matchesSearch(rows[0], '(469) 338')).toBe(true);
      expect(matchesSearch(rows[0], '366524', 366524)).toBe(true);
      expect(matchesSearch(rows[0], 'zzz')).toBe(false);
    });

    it('sorts on any column, created desc by default and among equals', () => {
      expect(sortRows(rows, 'created', 'desc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
      expect(sortRows(rows, 'total', 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
      expect(sortRows(rows, 'total', 'desc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
      // Same client everywhere → ties fall back to newest created first.
      expect(sortRows(rows, 'client', 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
      expect(sortRows(rows, 'jobNumber', 'desc').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    });

    it('pages with Workiz\'s "Showing X to Y of N"', () => {
      const all = Array.from({ length: 120 }, (_, i) => i);
      expect(paginate(all, 3, 50).pagination).toEqual({ page: 3, pageSize: 50, total: 120, pages: 3, from: 101, to: 120 });
      expect(paginate(all, 9, 50).pagination.page).toBe(3);
      expect(paginate([], 1, 50).pagination).toEqual({ page: 1, pageSize: 50, total: 0, pages: 1, from: 0, to: 0 });
    });
  });

  describe('CSV', () => {
    it('prints dates the way Workiz does', () => {
      expect(workizDate('2026-09-29T14:35')).toBe('Tue Sep 29, 2026 02:35 pm');
      expect(workizDate('2026-09-29T00:05')).toBe('Tue Sep 29, 2026 12:05 am');
      expect(workizDate('2026-09-29T12:00')).toBe('Tue Sep 29, 2026 12:00 pm');
      expect(workizDate('2026-09-29')).toBe('Tue Sep 29, 2026');
      expect(workizDate(undefined)).toBe('');
      expect(formatPhone('+14693386825')).toBe('(469) 338-6825');
      expect(formatPhone('+442071234567')).toBe('+442071234567');
    });

    it('writes the visible columns in the report order with Workiz headers', () => {
      const row = toRow(toReportDeal(imported()), lookups(), ALL);
      expect(csvHeader(JOBS_REPORT_DEFAULT_COLUMNS)).toBe(
        'Job #,Client,Tags,Type,Job Created,Scheduled,End,Phone,Status,Tech,City,State,Zip code,Metro Area,Total,Source',
      );
      expect(csvLine(row, JOBS_REPORT_DEFAULT_COLUMNS)).toBe(
        '0XJH37,Kayleigh Brown,"NEEDS A CALL, VIP",Car key,"Mon Aug 03, 2026 05:43 pm","Thu Sep 24, 2026 09:00 am",' +
          '"Thu Sep 24, 2026 01:00 pm",(469) 338-6825,Done - Paid,(2) TX - Sam,Denison,Texas,75020,SURE LOCK SHERMAN TX,697.95,SURE TX SHERMAN GMB',
      );
      expect(cellText(row, 'origin')).toBe('New');
    });

    it('quotes what needs quoting and defuses formulas in text cells', () => {
      expect(csvField('a,b')).toBe('"a,b"');
      expect(csvField('say "hi"')).toBe('"say ""hi"""');
      expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
      expect(csvField('-5.00', true)).toBe('-5.00');
    });

    it('leaves Total empty when money is withheld', () => {
      const row = toRow(toReportDeal(imported()), lookups(), { money: false, numbers: true });
      expect(cellText(row, 'total')).toBe('');
    });
  });

  it('ReportDeal keeps no attribute the report does not use', () => {
    const d: ReportDeal = toReportDeal(imported({ notes: 'secret', commissionSnapshot: { x: 1 } }));
    expect(Object.keys(d)).not.toContain('notes');
    expect(Object.keys(d)).not.toContain('commissionSnapshot');
  });
});
