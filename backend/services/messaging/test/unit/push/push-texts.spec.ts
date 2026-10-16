import { type Message } from '@bitcrm/types';
import {
  jobAssignedPush,
  jobCanceledPush,
  jobRescheduledPush,
  jobUnassignedPush,
  messagePreview,
  whenText,
} from '../../../src/push/push-texts';
import { type RenderContext } from '../../../src/templates/render-context';

const ctx = (deal: RenderContext['deal'] = {}, extra: Partial<RenderContext> = {}): RenderContext => ({
  deal: {
    id: 'd1',
    dealNumber: '1042',
    jobTypeName: 'Lockout',
    scheduledDate: '2026-10-16',
    scheduledTimeSlot: '10:00-12:00',
    assignedTechIds: ['t1'],
    ...deal,
  },
  contact: { firstName: 'Jane', lastName: 'Doe' },
  timezone: 'America/Chicago',
  ...extra,
});

/** The visit as the technician reads it on the lock screen: the job's own clock, with its zone. */
describe('whenText', () => {
  it('says the day and the start of the window in the job zone', () => {
    expect(whenText(ctx())).toBe('Fri Oct 16, 10:00 AM CDT');
    expect(whenText(ctx({}, { timezone: 'America/New_York' }))).toBe('Fri Oct 16, 10:00 AM EDT');
  });

  it('an all-day job, a job with no time, and an unscheduled one', () => {
    expect(whenText(ctx({ allDay: true }))).toBe('Fri Oct 16, All day');
    expect(whenText(ctx({ scheduledTimeSlot: undefined }))).toBe('Fri Oct 16');
    expect(whenText(ctx({ scheduledDate: undefined }))).toBe('Unscheduled');
  });
});

describe('job pushes (Workiz parity — what changed, without opening the app)', () => {
  it('New job assigned: job type, number, client and when', () => {
    expect(jobAssignedPush(ctx())).toEqual({
      title: 'New job assigned',
      body: 'Lockout #1042 · Jane Doe · Fri Oct 16, 10:00 AM CDT',
      data: { type: 'job_assigned', dealId: 'd1' },
    });
  });

  it("falls back to 'Job' without a type, prefers the job's own client name, then the company", () => {
    expect(jobAssignedPush(ctx({ jobTypeName: undefined, clientName: { firstName: 'Bob', lastName: 'Ray' } })).body).toBe(
      'Job #1042 · Bob Ray · Fri Oct 16, 10:00 AM CDT',
    );
    expect(jobAssignedPush(ctx({}, { contact: undefined, company: { title: 'Acme LLC' } })).body).toBe(
      'Lockout #1042 · Acme LLC · Fri Oct 16, 10:00 AM CDT',
    );
    expect(jobAssignedPush(ctx({}, { contact: undefined })).body).toBe('Lockout #1042 · Fri Oct 16, 10:00 AM CDT');
  });

  it('Job rescheduled: the number and the new time', () => {
    expect(jobRescheduledPush(ctx({ scheduledDate: '2026-10-17', scheduledTimeSlot: '14:00-16:00' }))).toEqual({
      title: 'Job rescheduled',
      body: '#1042 moved to Sat Oct 17, 2:00 PM CDT',
      data: { type: 'job_rescheduled', dealId: 'd1' },
    });
  });

  it('Job canceled: the number and the client', () => {
    expect(jobCanceledPush(ctx())).toEqual({ title: 'Job canceled', body: '#1042 · Jane Doe', data: { type: 'job_canceled', dealId: 'd1' } });
  });

  it('Removed from job: the number', () => {
    expect(jobUnassignedPush(ctx())).toEqual({ title: 'Removed from job', body: '#1042', data: { type: 'job_unassigned', dealId: 'd1' } });
  });
});

describe('messagePreview', () => {
  const m = (over: Partial<Message>): Message =>
    ({ id: 'm1', conversationId: 'c1', channel: 'sms', direction: 'inbound', status: 'received', origin: 'contact', createdAt: 'x', updatedAt: 'x', ...over }) as Message;

  it('is the text, whitespace folded, cut at 140 characters', () => {
    expect(messagePreview(m({ body: '  Gate code\n\n is 4512  ' }))).toBe('Gate code is 4512');
    const long = 'a'.repeat(200);
    const preview = messagePreview(m({ body: long }))!;
    expect(preview).toHaveLength(140);
    expect(preview.endsWith('…')).toBe(true);
  });

  it("an email without text says its subject, a bare photo says so, nothing at all is nothing", () => {
    expect(messagePreview(m({ channel: 'email', subject: 'Invoice question' }))).toBe('Invoice question');
    expect(messagePreview(m({ channel: 'mms', attachments: [{ id: 'a', fileName: 'p.jpg', contentType: 'image/jpeg', status: 'stored' }] }))).toBe(
      'Sent an attachment',
    );
    expect(messagePreview(m({ body: '   ' }))).toBeUndefined();
  });
});
