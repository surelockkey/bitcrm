/* eslint-disable @typescript-eslint/no-explicit-any */
import { MessagingClient } from 'src/integrations/messaging.client';

/** A `fetch` that records what billing sent messaging and answers 201. */
function fakeFetch() {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = jest.fn(async (url: string, init?: any) => {
    calls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ success: true, data: { id: 'msg-1' } }) };
  });
  return { fetchImpl, calls };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('MessagingClient — billing asks messaging, on the caller’s bearer', () => {
  it('sends to the client’s thread, to the address it is given, filed under the job', async () => {
    const { fetchImpl, calls } = fakeFetch();
    await new MessagingClient(fetchImpl as any).sendToContact(
      {
        contactId: 'contact-1',
        channel: 'email',
        body: 'Receipt for invoice K4T9ZW',
        subject: 'Your payment with Sure Lock Key',
        toAddress: 'walter@example.com',
        dealId: '6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f',
      },
      'Bearer abc',
    );
    expect(calls[0].url).toMatch(/\/api\/messaging\/messages$/);
    expect(calls[0].init).toMatchObject({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer abc' }) });
    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({
      clientMessageId: expect.stringMatching(UUID),
      channel: 'email',
      body: 'Receipt for invoice K4T9ZW',
      subject: 'Your payment with Sure Lock Key',
      contactId: 'contact-1',
      toAddress: 'walter@example.com',
      dealId: '6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f',
    });
  });

  it('leaves the address and the job out when it has none — messaging picks the thread’s own', async () => {
    const { fetchImpl, calls } = fakeFetch();
    await new MessagingClient(fetchImpl as any).sendToContact(
      { contactId: 'contact-1', channel: 'sms', body: 'Receipt' },
      'Bearer abc',
    );
    expect(Object.keys(JSON.parse(calls[0].init.body)).sort()).toEqual(['body', 'channel', 'clientMessageId', 'contactId']);
  });

  it('texts a bare number — not one of the client’s — on that number’s own thread', async () => {
    const { fetchImpl, calls } = fakeFetch();
    await new MessagingClient(fetchImpl as any).sendToNumber(
      { phone: '+14045550111', body: 'Receipt for job K4T9ZW', dealId: '6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f' },
      'Bearer abc',
    );
    expect(calls[0].url).toMatch(/\/api\/messaging\/messages$/);
    expect(JSON.parse(calls[0].init.body)).toEqual({
      clientMessageId: expect.stringMatching(UUID),
      channel: 'sms',
      body: 'Receipt for job K4T9ZW',
      phone: '+14045550111',
      dealId: '6f1c2b8e-3d4a-4b5c-9e7f-0a1b2c3d4e5f',
    });
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer abc' });
  });
});

describe('MessagingClient attachments — a document’s PDF uploaded the way the composer uploads a file', () => {
  it('presigns on the caller’s bearer, PUTs the bytes with the signed headers, and hands back what attachments[] needs', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = jest.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      if (url.endsWith('/attachments/presign')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            data: {
              id: '7b3e1c2a-1111-4222-8333-444455556666',
              s3Key: 'messaging/uploads/u-1/7b3e1c2a-1111-4222-8333-444455556666',
              uploadUrl: 'https://s3/upload?sig=1',
              headers: { 'Content-Type': 'application/pdf', 'x-amz-server-side-encryption': 'aws:kms' },
              expiresIn: 900,
              fileName: 'Estimate-1142.pdf',
              contentType: 'application/pdf',
              size: 4,
              maxBytes: 5242880,
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const client = new MessagingClient(fetchImpl as any);
    const bytes = Buffer.from('%PDF');
    const attachment = await client.uploadAttachment({ fileName: 'Estimate-1142.pdf', contentType: 'application/pdf', bytes }, 'Bearer abc');
    expect(calls[0].url).toMatch(/\/api\/messaging\/attachments\/presign$/);
    expect(calls[0].init).toMatchObject({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer abc' }) });
    expect(JSON.parse(calls[0].init.body)).toEqual({ fileName: 'Estimate-1142.pdf', contentType: 'application/pdf', size: 4 });
    expect(calls[1].url).toBe('https://s3/upload?sig=1');
    expect(calls[1].init).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf', 'x-amz-server-side-encryption': 'aws:kms' },
    });
    expect(Buffer.from(calls[1].init.body)).toEqual(bytes);
    expect(attachment).toEqual({
      id: '7b3e1c2a-1111-4222-8333-444455556666',
      fileName: 'Estimate-1142.pdf',
      contentType: 'application/pdf',
      size: 4,
    });
  });

  it('a refused PUT is an error — the attachment is never claimed', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('/attachments/presign')
        ? {
            ok: true,
            status: 201,
            json: async () => ({ success: true, data: { id: '7b3e1c2a-1111-4222-8333-444455556666', uploadUrl: 'https://s3/u', headers: {} } }),
          }
        : { ok: false, status: 403, json: async () => ({}) },
    );
    await expect(
      new MessagingClient(fetchImpl as any).uploadAttachment(
        { fileName: 'a.pdf', contentType: 'application/pdf', bytes: Buffer.from('x') },
        'Bearer abc',
      ),
    ).rejects.toThrow(/upload.*403/i);
  });
});

describe('MessagingClient.recordPortalEvent — the portal line in the client’s thread', () => {
  it('posts to messaging’s internal route on the service secret, not a caller’s bearer', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const event = {
      contactId: 'contact-1',
      event: 'signed' as const,
      document: { kind: 'invoice' as const, id: 'deal-1', number: 'K4T9ZW' },
      dealId: 'deal-1',
      actorName: 'Jane Client',
      eventKey: 'signed:invoice:deal-1:2026-10-02T10:00:00.000Z',
    };
    await new MessagingClient(fetchImpl as any).recordPortalEvent(event);
    expect(calls[0].url).toMatch(/\/api\/messaging\/internal\/portal-events$/);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toHaveProperty('x-internal-secret');
    expect(calls[0].init.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(calls[0].init.body)).toEqual(event);
  });
});
