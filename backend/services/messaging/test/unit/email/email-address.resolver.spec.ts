import { EmailAddressResolver, formatAddress } from '../../../src/email/email-address.resolver';

function make(config: { fromAddress?: string; domain?: string; replyDomain?: string }, settings: Record<string, unknown> | null = null) {
  const repo = { get: jest.fn(async () => settings) };
  return { resolver: new EmailAddressResolver(config, repo as any), repo };
}

describe('EmailAddressResolver', () => {
  it('is unconfigured without MESSAGING_EMAIL_FROM and resolves to null', async () => {
    const { resolver, repo } = make({});
    expect(resolver.configured).toBe(false);
    expect(await resolver.resolve('c1')).toBeNull();
    expect(repo.get).not.toHaveBeenCalled();
  });

  it('sends from the configured address with the company name and a reply-to token', async () => {
    const { resolver } = make(
      { fromAddress: 'office@example.com', domain: 'example.com', replyDomain: 'reply.example.com' },
      { companyName: 'Sure Lock & Key' },
    );
    expect(resolver.configured).toBe(true);
    expect(await resolver.resolve('c1')).toEqual({
      from: 'office@example.com',
      fromHeader: '"Sure Lock & Key" <office@example.com>',
      replyTo: 'c-c1@reply.example.com',
    });
  });

  it('prefers companyEmail when it sits on the verified domain, never otherwise', async () => {
    const onDomain = make({ fromAddress: 'office@example.com', domain: 'example.com' }, { companyEmail: 'Hello@Example.com' });
    expect((await onDomain.resolver.resolve('c1'))?.from).toBe('hello@example.com');

    const elsewhere = make({ fromAddress: 'office@example.com', domain: 'example.com' }, { companyEmail: 'owner@gmail.com' });
    expect((await elsewhere.resolver.resolve('c1'))?.from).toBe('office@example.com');

    // no explicit domain: the sender's own domain is the verified one
    const implied = make({ fromAddress: 'office@example.com' }, { companyEmail: 'sales@example.com' });
    expect((await implied.resolver.resolve('c1'))?.from).toBe('sales@example.com');
  });

  it('survives a settings read failure', async () => {
    const { resolver, repo } = make({ fromAddress: 'office@example.com' });
    repo.get.mockRejectedValueOnce(new Error('dynamo down'));
    expect(await resolver.resolve('c1')).toEqual({
      from: 'office@example.com',
      fromHeader: 'office@example.com',
      replyTo: 'office+c-c1@example.com',
    });
  });
});

describe('formatAddress', () => {
  it('quotes display names that need it and strips line breaks', () => {
    expect(formatAddress('a@b.co')).toBe('a@b.co');
    expect(formatAddress('a@b.co', 'Sure Lock')).toBe('Sure Lock <a@b.co>');
    expect(formatAddress('a@b.co', 'Sure Lock & Key')).toBe('"Sure Lock & Key" <a@b.co>');
    expect(formatAddress('a@b.co', 'Say "hi"')).toBe('"Say \\"hi\\"" <a@b.co>');
    expect(formatAddress('a@b.co', 'Evil\r\nBcc: x@y.z')).toBe('"Evil Bcc: x@y.z" <a@b.co>');
    expect(formatAddress('a@b.co', '   ')).toBe('a@b.co');
  });
});
