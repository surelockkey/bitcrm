import {
  looksLikePhone,
  maskConversation,
  maskConversations,
  maskMessage,
  maskMessages,
} from '../../../src/api/access/masking';
import { createMockConversation, createMockMessage } from '../mocks';

describe('looksLikePhone', () => {
  it('accepts E.164 and bare digit runs, rejects emails and short strings', () => {
    expect(looksLikePhone('+14045551234')).toBe(true);
    expect(looksLikePhone('4045551234')).toBe(true);
    expect(looksLikePhone('jane@example.com')).toBe(false);
    expect(looksLikePhone('123')).toBe(false);
    expect(looksLikePhone(undefined)).toBe(false);
  });
});

describe('maskConversation', () => {
  const c = createMockConversation({ addresses: { phones: ['+14045551234'], emails: ['jane@example.com'] } });

  it('returns the same object when allowed', () => {
    expect(maskConversation(c, true)).toBe(c);
  });

  it('withholds the phones, keeps the emails, and flags the omission — on a copy', () => {
    const masked = maskConversation(c, false);
    expect(masked).not.toBe(c);
    expect(masked.addresses).toEqual({ phones: [], emails: ['jane@example.com'] });
    expect(masked.phonesMasked).toBe(true);
    expect(masked.partyId).toBe('ct1');
    expect(c.addresses.phones).toEqual(['+14045551234']); // untouched
  });

  it('does not flag a conversation that had no phones', () => {
    const masked = maskConversation(createMockConversation({ addresses: { phones: [], emails: [] } }), false);
    expect(masked.phonesMasked).toBeUndefined();
  });

  it('passes null through', () => {
    expect(maskConversation(null, false)).toBeNull();
  });

  it('maskConversations maps the list only when masking', () => {
    const list = [c];
    expect(maskConversations(list, true)).toBe(list);
    expect(maskConversations(list, false)[0].phonesMasked).toBe(true);
  });
});

describe('maskMessage', () => {
  it('masks the client end of an inbound SMS but never the business number', () => {
    const m = createMockMessage({ from: '+14045551234', to: '+15550001111', businessNumber: '+15550001111' });
    const masked = maskMessage(m, false);
    expect(masked.from).toBeUndefined();
    expect(masked.fromMasked).toBe(true);
    expect(masked.to).toBe('+15550001111');
    expect(masked.toMasked).toBeUndefined();
    expect(m.from).toBe('+14045551234');
  });

  it('masks the client end of an outbound SMS', () => {
    const m = createMockMessage({
      direction: 'outbound',
      from: '+15550001111',
      to: '+14045551234',
      businessNumber: '+15550001111',
    });
    const masked = maskMessage(m, false);
    expect(masked.from).toBe('+15550001111');
    expect(masked.to).toBeUndefined();
    expect(masked.toMasked).toBe(true);
  });

  it('masks both ends when the business number is unknown (Workiz history)', () => {
    const m = createMockMessage({ from: '+14045551234', to: '+15550001111', businessNumber: undefined });
    const masked = maskMessage(m, false);
    expect(masked.fromMasked).toBe(true);
    expect(masked.toMasked).toBe(true);
  });

  it('keeps email addresses and the body, drops contactAddress and raw Workiz meta', () => {
    const m = createMockMessage({
      channel: 'email',
      from: 'jane@example.com',
      to: 'office@company.com',
      contactAddress: '+14045551234',
      workizMeta: { contact_phone: '+14045551234' },
    });
    const masked = maskMessage(m, false);
    expect(masked.from).toBe('jane@example.com');
    expect(masked.to).toBe('office@company.com');
    expect(masked.body).toBe('Hello');
    expect(masked.contactAddress).toBeUndefined();
    expect(masked.contactAddressMasked).toBe(true);
    expect(masked.workizMeta).toBeUndefined();
  });

  it('returns the same object when allowed; maskMessages likewise', () => {
    const m = createMockMessage();
    expect(maskMessage(m, true)).toBe(m);
    const list = [m];
    expect(maskMessages(list, true)).toBe(list);
    expect(maskMessages(list, false)[0].fromMasked).toBe(true);
  });
});
