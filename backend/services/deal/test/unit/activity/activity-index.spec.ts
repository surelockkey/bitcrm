import { AccountClock, TimelineEventType } from '@bitcrm/types';
import {
  activityIndexFields,
  activityRowOf,
  activitySearchOf,
  activityTextOf,
  isActivityItem,
  nativeActivityText,
} from 'src/activity/activity-index';
import {
  activitySourceFromHeaders,
  ActivitySourceMiddleware,
  currentActivitySource,
  withActivitySource,
} from 'src/activity/activity-source';

const clock = new AccountClock();

/** An imported Workiz activity row on a job, as the package writes it. */
const workizJobRow = (over: Record<string, unknown> = {}) => ({
  PK: 'DEAL#d1',
  SK: 'TIMELINE#2026-09-18T21:45:00.600Z#a1',
  id: 'a1',
  dealId: 'd1',
  eventType: 'field_updated',
  actorId: 'u-taylor',
  actorName: '(1) (Taylor) 12 Dispatcher',
  timestamp: '2026-09-18T21:45:00.600Z',
  details: {
    source: 'workiz',
    workiz: { kind: 'job_updated', text: 'Update job details', jobUuid: 'EF8Z4O', jobSerial: 371680, native: false, doneByAI: false },
  },
  source: 'workiz',
  externalId: 'workiz:activity:2649e619:0',
  ...over,
});

describe('Activity — which timeline rows are events of the report', () => {
  it('takes every native event and Workiz’s own activity rows', () => {
    expect(isActivityItem({ PK: 'DEAL#d1', SK: 'TIMELINE#2026-09-30T10:00:00.000Z#n1', id: 'n1', timestamp: '2026-09-30T10:00:00.000Z', eventType: 'created' })).toBe(true);
    expect(isActivityItem(workizJobRow())).toBe(true);
    // A job-less event (login, client created) lives on an ACT# row.
    expect(isActivityItem({ ...workizJobRow(), PK: 'USER#u1', SK: 'ACT#2026-07-04T20:00:00.600Z#x' })).toBe(true);
  });

  it('leaves out Workiz’s job comments and the import’s synthetic "created" rows', () => {
    expect(isActivityItem({ ...workizJobRow(), eventType: 'note_added', externalId: 'workiz:note:57914906' })).toBe(false);
    expect(isActivityItem({ ...workizJobRow(), eventType: 'created', externalId: 'workiz:timeline:job:49338744:created' })).toBe(false);
  });

  it('never indexes a deal, a line item or anything that is not a timeline row', () => {
    expect(isActivityItem({ PK: 'DEAL#d1', SK: 'METADATA', id: 'd1', timestamp: 'x' })).toBe(false);
    expect(isActivityItem({ PK: 'DEAL#d1', SK: 'PRODUCT#p1', id: 'p1', timestamp: 'x' })).toBe(false);
  });
});

describe('Activity — index keys', () => {
  it('files an event under its New York day, and under its actor', () => {
    // 00:30 UTC on the 19th is 20:30 on the 18th in New York.
    const fields = activityIndexFields(
      workizJobRow({ timestamp: '2026-09-19T00:30:00.600Z', SK: 'TIMELINE#2026-09-19T00:30:00.600Z#a1' }),
      clock,
    );
    expect(fields).toEqual({
      GSI8PK: 'ACTDAY#2026-09-18',
      GSI8SK: '2026-09-19T00:30:00.600Z#a1',
      GSI9PK: 'ACTOR#u-taylor',
      GSI9SK: '2026-09-19T00:30:00.600Z#a1',
      activitySearch: 'update job details\nef8z4o',
    });
  });

  it('does not index actors nobody can filter by', () => {
    for (const actorId of ['workiz:unresolved', 'system']) {
      const fields = activityIndexFields(workizJobRow({ actorId }), clock)!;
      expect(fields.GSI8PK).toBe('ACTDAY#2026-09-18');
      expect(fields).not.toHaveProperty('GSI9PK');
    }
  });

  it('records where a native event was done — never over an imported one', () => {
    const native = {
      PK: 'DEAL#d1', SK: 'TIMELINE#2026-09-30T14:00:00.000Z#n1', id: 'n1', dealId: 'd1',
      eventType: TimelineEventType.CREATED, actorId: 'u1', actorName: 'a@b.c', timestamp: '2026-09-30T14:00:00.000Z', details: {},
    };
    expect(activityIndexFields(native, clock, 'mobile')).toMatchObject({ activitySource: 'mobile', activitySearch: 'created job' });
    expect(activityIndexFields(workizJobRow(), clock, 'mobile')).not.toHaveProperty('activitySource');
  });

  it('is null for rows that are not events', () => {
    expect(activityIndexFields({ PK: 'DEAL#d1', SK: 'METADATA', id: 'd1', timestamp: 'x' }, clock)).toBeNull();
  });
});

describe('Activity — what a row prints', () => {
  it('keeps Workiz’s text, name and device for an imported event', () => {
    const row = activityRowOf(workizJobRow({ details: { source: 'workiz', workiz: { text: 'Logged In From 71.233.152.58', native: true, doneByAI: true } } }));
    expect(row).toEqual({
      id: 'a1',
      timestamp: '2026-09-18T21:45:00.600Z',
      actorId: 'u-taylor',
      actorName: '(1) (Taylor) 12 Dispatcher',
      imported: true,
      text: 'Logged In From 71.233.152.58',
      source: 'mobile',
      doneByAI: true,
      dealId: 'd1',
    });
  });

  it('prints the job code, and links only a job that is a deal here', () => {
    expect(activityRowOf(workizJobRow())).toMatchObject({ dealId: 'd1', jobRef: 'EF8Z4O', source: 'web' });
    // A deleted Workiz job: the code, no link.
    const gone = activityRowOf(workizJobRow({ PK: 'WJOB#60855276', SK: 'ACT#2026-05-29T22:02:00.600Z#x', dealId: undefined }));
    expect(gone.jobRef).toBe('EF8Z4O');
    expect(gone).not.toHaveProperty('dealId');
  });

  it('shows an empty action where Workiz’s own text was empty', () => {
    const row = workizJobRow({ eventType: 'workiz_activity', details: { source: 'workiz', workiz: { kind: 'client_created' } } });
    expect(activityTextOf(row)).toBe('');
  });

  it('names a native event with its deal number and Workiz’s words', () => {
    const row = activityRowOf(
      {
        PK: 'DEAL#d1', SK: 'TIMELINE#2026-09-30T14:00:00.000Z#n1', id: 'n1', dealId: 'd1',
        eventType: TimelineEventType.STATUS_CHANGED, actorId: 'u1', actorName: 'dana@x.com',
        timestamp: '2026-09-30T14:00:00.000Z', details: { fromStatus: 'submitted', toStatus: 'done' }, activitySource: 'web',
      },
      'AB12CD',
    );
    expect(row).toMatchObject({ imported: false, text: 'Status Updated - Done - ', source: 'web', dealId: 'd1', jobRef: 'AB12CD' });
  });

  // Workiz's own words, read off its live log (data/raw/activity.jsonl, Jul–Sep 2026, and
  // rep_activity_wz_06_yesterday): "Status Updated - In progress - Job Accepted",
  // "Status Updated - Done - ", "Added item Parts (35.00)", "Item price updated: Service Call — 45.00 → 35.00",
  // "Added payment 349.89 in Cash", "Deleted payment 433 cash", "Refunded payment 109.54 charge",
  // "Created invoice #SGHDLK", "Updated estimate 8HNU0Y-6 status to Declined", "Added tag",
  // "Added tag(s)", "Remove tag from job", "Updated tags".
  it.each([
    [TimelineEventType.CREATED, {}, 'Created Job'],
    [TimelineEventType.FIELD_UPDATED, { field: 'scheduledDate' }, 'Rescheduled job'],
    [TimelineEventType.FIELD_UPDATED, { field: 'notes' }, 'Update job details'],
    [TimelineEventType.STATUS_CHANGED, { toStatus: 'submitted' }, 'Status Updated - Submitted - '],
    [TimelineEventType.STATUS_CHANGED, { toStatus: 'in_progress', subStatusName: 'Job Accepted' }, 'Status Updated - In progress - Job Accepted'],
    [TimelineEventType.STATUS_CHANGED, { toStatus: 'done_pending_approval', subStatusName: 'CHEQUE' }, 'Status Updated - done pending approval - CHEQUE'],
    [
      TimelineEventType.STATUS_CHANGED,
      { toStatus: 'canceled', subStatusName: 'Cant Do', cancellationReason: 'tech said cant do' },
      'Status Updated - Canceled - Cant Do - tech said cant do',
    ],
    // The sub-status IS the reason when none was typed: said once.
    [TimelineEventType.STATUS_CHANGED, { toStatus: 'canceled', subStatusName: 'Out of area', cancellationReason: 'Out of area' }, 'Status Updated - Canceled - Out of area'],
    [TimelineEventType.FIELD_UPDATED, { field: 'tagIds', oldValue: ['a'], newValue: ['a', 'b'] }, 'Added tag'],
    [TimelineEventType.FIELD_UPDATED, { field: 'tagIds', oldValue: [], newValue: ['a', 'b'] }, 'Added tag(s)'],
    [TimelineEventType.FIELD_UPDATED, { field: 'tagIds', oldValue: ['a', 'b'], newValue: ['a'] }, 'Remove tag from job'],
    [TimelineEventType.FIELD_UPDATED, { field: 'tagIds', oldValue: ['a'], newValue: ['b'] }, 'Updated tags'],
    [TimelineEventType.PRODUCT_ADDED, { productName: 'Service Call', priceClient: 150 }, 'Added item Service Call (150.00)'],
    [TimelineEventType.PRODUCT_ADDED, { productName: 'Service call' }, 'Added item Service call'],
    [TimelineEventType.PRODUCT_REMOVED, { productName: 'Parts', priceClient: 35 }, 'Removed item Parts (35.00)'],
    [
      TimelineEventType.PRODUCT_UPDATED,
      { productName: 'Service Call', changes: { priceClient: { from: 45, to: 35 } } },
      'Item price updated: Service Call — 45.00 → 35.00',
    ],
    [TimelineEventType.PRODUCT_UPDATED, { productName: 'Parts', changes: { quantity: { from: 1, to: 2 } } }, 'Update job details'],
    [TimelineEventType.SENT_TO_TECH, { channels: ['sms', 'in_app'] }, 'Sent to tech by SMS, In App'],
    [TimelineEventType.SEEN_BY_TECH, {}, 'Viewed job in app'],
    [TimelineEventType.ATTACHMENT_ADDED, {}, 'Saved Attachment'],
    [TimelineEventType.PAYMENT_RECEIVED, { amount: 349.89, method: 'cash' }, 'Added payment 349.89 in Cash'],
    [TimelineEventType.PAYMENT_RECEIVED, { amount: 303.1, method: 'check' }, 'Added payment 303.10 in Check'],
    [TimelineEventType.PAYMENT_RECEIVED, { amount: 295.48, method: 'card' }, 'Added payment 295.48 in Credit charge'],
    [TimelineEventType.PAYMENT_RECEIVED, { amount: 70.5, method: 'credit_card' }, 'Added payment 70.50 in Credit card'],
    [TimelineEventType.PAYMENT_REFUNDED, { amount: 109.54, method: 'card', refundId: 'r1' }, 'Refunded payment 109.54 charge'],
    [TimelineEventType.PAYMENT_REFUNDED, { amount: 433, method: 'cash', deleted: true }, 'Deleted payment 433 cash'],
    [TimelineEventType.PAYMENT_REFUNDED, { amount: 1600, method: 'card', deleted: true }, 'Deleted payment 1600 credit'],
    [TimelineEventType.INVOICE_CREATED, { number: 'SGHDLK' }, 'Created invoice #SGHDLK'],
    [TimelineEventType.INVOICE_CREATED, {}, 'Created invoice'],
    [TimelineEventType.INVOICE_DELETED, { number: 'HMZX4X' }, 'Deleted invoice #HMZX4X'],
    [TimelineEventType.ESTIMATE_STATUS_CHANGED, { number: '8HNU0Y-6', to: 'declined' }, 'Updated estimate 8HNU0Y-6 status to Declined'],
    [TimelineEventType.ESTIMATE_STATUS_CHANGED, { number: '8HNU0Y-6', signed: true }, 'Client signed estimate'],
    [TimelineEventType.TECH_ARRIVED, {}, 'Arrived at location'],
  ])('%s %j reads "%s"', (type, details, text) => {
    expect(nativeActivityText(type, details)).toBe(text);
  });

  // Workiz keeps job comments out of its Activity log (the import leaves out its
  // 397,017 `workiz:note` rows for that reason); our own notes stay out too.
  it('leaves our own job notes out of the report', () => {
    const note = { PK: 'DEAL#d1', SK: 'TIMELINE#2026-09-30T10:00:00.000Z#n2', id: 'n2', timestamp: '2026-09-30T10:00:00.000Z', eventType: TimelineEventType.NOTE_ADDED, note: 'Client asked for Friday', details: {} };
    expect(isActivityItem(note)).toBe(false);
    expect(activityIndexFields(note, clock, 'web')).toBeNull();
  });

  it('searches an action by its words', () => {
    expect(
      activitySearchOf({ SK: 'TIMELINE#t#n', eventType: TimelineEventType.INVOICE_CREATED, details: { number: 'SGHDLK' } }),
    ).toBe('created invoice #sghdlk');
  });
});

describe('Activity — where a request came from', () => {
  it.each([
    [{ 'x-bitcrm-client': 'mobile', 'user-agent': 'Mozilla/5.0' }, 'mobile'],
    [{ 'x-internal-secret': 's3cret', 'user-agent': 'node' }, 'system'],
    [{ 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/140' }, 'web'],
    [{ 'user-agent': 'BitCRM/57 CFNetwork/1498 Darwin/24.0.0' }, 'mobile'],
    [{ 'user-agent': 'okhttp/4.12.0' }, 'mobile'],
    [{ 'user-agent': 'curl/8.4' }, undefined],
  ])('%j → %s', (headers, source) => {
    expect(activitySourceFromHeaders(headers)).toBe(source);
  });

  it('holds the source for the rest of the request', async () => {
    const mw = new ActivitySourceMiddleware();
    let seen: unknown = 'unset';
    await new Promise<void>((done) =>
      mw.use({ headers: { 'user-agent': 'okhttp/4.12.0' } } as never, {} as never, () => {
        void Promise.resolve().then(() => {
          seen = currentActivitySource();
          done();
        });
      }),
    );
    expect(seen).toBe('mobile');
    expect(withActivitySource('web', () => currentActivitySource())).toBe('web');
    expect(currentActivitySource()).toBeUndefined();
  });
});
