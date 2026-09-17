import { type MessageAttachment } from '@bitcrm/types';
import {
  PUSH_BODY_MAX,
  jobPushBody,
  jobPushTitle,
  messagePushBody,
  messagePushTitle,
  shortAddress,
  timeRange,
} from '../../../src/push/push-text';
import { createMockConversation, createMockMessage } from '../mocks';

const TZ = 'America/New_York';
const ADDRESS = { street: '128 Main St', city: 'Hartford', state: 'CT', zip: '06103' };

describe('push text — what a technician reads on a lock screen', () => {
  describe('a job', () => {
    it('is titled after the job number, like the Send-to-tech email subject', () => {
      expect(jobPushTitle({ dealNumber: 'A3F9K2' })).toBe('New job #A3F9K2');
      expect(jobPushTitle({})).toBe('New job');
    });

    it('answers when and where, in that order', () => {
      expect(
        jobPushBody({ scheduledDate: '2026-09-20', scheduledTimeSlot: '09:00-12:00', address: ADDRESS }, TZ),
      ).toBe('Sep 20, 2026 · 9:00 AM–12:00 PM · 128 Main St, Hartford');
    });

    it('leaves out what the job has not got, and never says nothing at all', () => {
      expect(jobPushBody({ scheduledDate: '2026-09-20' }, TZ)).toBe('Sep 20, 2026');
      expect(jobPushBody({ address: ADDRESS }, TZ)).toBe('128 Main St, Hartford');
      expect(jobPushBody({}, TZ)).toBe('Tap to open the job');
    });

    it('never puts an id or a channel name in front of a person', () => {
      const body = jobPushBody({ scheduledDate: '2026-09-20', scheduledTimeSlot: '09:00-12:00', address: ADDRESS }, TZ);
      expect(body).not.toMatch(/deal|conversation|in_app|uuid/i);
    });

    it('reads a wall-clock slot in the company zone, and copes with half a slot', () => {
      expect(timeRange('09:00-12:00', TZ)).toBe('9:00 AM–12:00 PM');
      expect(timeRange('14:30', TZ)).toBe('2:30 PM');
      expect(timeRange(undefined, TZ)).toBeUndefined();
      expect(timeRange('all day', TZ)).toBeUndefined();
    });

    it('shortens the address to what a driver needs', () => {
      expect(shortAddress(ADDRESS)).toBe('128 Main St, Hartford');
      expect(shortAddress({ ...ADDRESS, unit: 'Apt 4' })).toBe('128 Main St Apt 4, Hartford');
      expect(shortAddress({ street: '', city: '', state: 'CT', zip: '06103' })).toBeUndefined();
      expect(shortAddress(undefined)).toBeUndefined();
    });
  });

  describe('a message', () => {
    const team = createMockConversation({ id: 'c1', kind: 'team', partyKind: 'user', partyId: 'u1' });
    const group = createMockConversation({ id: 'c2', kind: 'group', name: 'Dispatch', memberIds: ['u1', 'u2'] });

    it('is titled by whoever the recipient would say it is from', () => {
      expect(messagePushTitle(createMockMessage({ sentByName: 'Ann Lee' }), team)).toBe('Ann Lee');
      expect(messagePushTitle(createMockMessage({}), team)).toBe('Office');
      expect(messagePushTitle(createMockMessage({ sentByName: 'Ann Lee' }), group)).toBe('Dispatch');
      expect(messagePushTitle(createMockMessage({}), createMockConversation({ kind: 'group' }))).toBe('Team chat');
    });

    it('shows the text, and in a group who said it', () => {
      expect(messagePushBody(createMockMessage({ body: 'Can you take 128 Main?' }), team)).toBe('Can you take 128 Main?');
      expect(messagePushBody(createMockMessage({ body: 'On it', sentByName: 'Ann Lee' }), group)).toBe('Ann Lee: On it');
    });

    it('collapses the whitespace a pasted message arrives with', () => {
      expect(messagePushBody(createMockMessage({ body: ' Please\n\ncall   the client ' }), team)).toBe(
        'Please call the client',
      );
    });

    it('says what arrived when the line is only an attachment', () => {
      const attachment: MessageAttachment = {
        id: 'a1',
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        status: 'stored',
      };
      expect(messagePushBody(createMockMessage({ body: '', attachments: [attachment] }), team)).toBe('Sent a photo');
      expect(messagePushBody(createMockMessage({ body: '', attachments: [attachment, attachment] }), team)).toBe(
        'Sent 2 photos',
      );
      expect(messagePushBody(createMockMessage({ body: '' }), team)).toBe('Sent a message');
    });

    it('cuts a long message on a word, so the last one is never half a word', () => {
      const body = messagePushBody(createMockMessage({ body: `${'word '.repeat(60)}end` }), team);
      expect(body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
      expect(body.endsWith('…')).toBe(true);
      expect(body).not.toMatch(/\bwor…$/);
    });
  });
});
