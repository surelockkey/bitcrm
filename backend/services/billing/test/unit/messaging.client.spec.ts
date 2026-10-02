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
