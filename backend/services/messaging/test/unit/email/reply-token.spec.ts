import { buildReplyAddress, findReplyToken, parseReplyAddress } from '../../../src/email/reply-token';

const ID = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';

describe('reply token', () => {
  it('uses the replies subdomain when configured', () => {
    const cfg = { fromAddress: 'office@example.com', replyDomain: 'reply.example.com' };
    expect(buildReplyAddress(ID, cfg)).toBe(`c-${ID}@reply.example.com`);
    expect(parseReplyAddress(`c-${ID}@reply.example.com`, cfg)).toBe(ID);
    expect(parseReplyAddress(`C-${ID.toUpperCase()}@Reply.Example.com`, cfg)).toBe(ID);
  });

  it('falls back to a plus-address on the sender without a replies subdomain', () => {
    const cfg = { fromAddress: 'office@example.com' };
    expect(buildReplyAddress(ID, cfg)).toBe(`office+c-${ID}@example.com`);
    expect(parseReplyAddress(`office+c-${ID}@example.com`, cfg)).toBe(ID);
    expect(buildReplyAddress(ID, {})).toBeUndefined();
    expect(buildReplyAddress(ID, { fromAddress: 'not-an-address' })).toBeUndefined();
  });

  it('refuses a token on another domain and anything that is not a token', () => {
    const cfg = { fromAddress: 'office@example.com', replyDomain: 'reply.example.com' };
    expect(parseReplyAddress(`c-${ID}@reply.other.com`, cfg)).toBeUndefined();
    expect(parseReplyAddress(`office+c-${ID}@other.com`, cfg)).toBeUndefined();
    expect(parseReplyAddress('c-not-a-uuid@reply.example.com', cfg)).toBeUndefined();
    expect(parseReplyAddress('jane@example.com', cfg)).toBeUndefined();
    // Without a configured domain any domain is accepted (local dev).
    expect(parseReplyAddress(`c-${ID}@whatever.test`, {})).toBe(ID);
  });

  it('finds the first token among the recipients', () => {
    const cfg = { replyDomain: 'reply.example.com' };
    expect(findReplyToken(['jane@example.com', `c-${ID}@reply.example.com`], cfg)).toBe(ID);
    expect(findReplyToken(['jane@example.com'], cfg)).toBeUndefined();
    expect(findReplyToken([], cfg)).toBeUndefined();
  });
});
