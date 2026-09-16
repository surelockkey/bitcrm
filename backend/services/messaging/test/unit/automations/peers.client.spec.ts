import { AutomationPeersClient } from '../../../src/automations/internal/peers.client';

const response = (status: number, data?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => ({ success: status < 300, data }) }) as unknown as Response;

/** A typed fake of the injected `fetch` so the calls can be inspected. */
const fakeFetch = (answer: () => Promise<Response>) =>
  jest.fn<Promise<Response>, [string, RequestInit?]>(answer);

describe('AutomationPeersClient', () => {
  it('reads the deal slice from the internal route with the secret header, uncached', async () => {
    const fetchImpl = fakeFetch(async () =>
      response(200, { id: 'd1', dealNumber: '1001', contactId: 'ct1', scheduledDate: '2026-09-20', scheduledTimeSlot: '09:00-11:00', assignedTechIds: ['t1'], superStatus: 'in_progress', extra: 1 }),
    );
    const client = new AutomationPeersClient(fetchImpl);
    expect(await client.deal('d1')).toEqual({
      id: 'd1', dealNumber: '1001', contactId: 'ct1', scheduledDate: '2026-09-20', scheduledTimeSlot: '09:00-11:00', assignedTechIds: ['t1'], assignedDispatcherId: undefined, superStatus: 'in_progress',
    });
    await client.deal('d1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/deals\/internal\/d1$/);
    expect(fetchImpl.mock.calls[0][1]?.headers).toHaveProperty('x-internal-secret');
  });

  it('reads the user slice and treats a blank phone or email as absent', async () => {
    const fetchImpl = fakeFetch(async () => response(200, { id: 'u1', firstName: 'Ann', lastName: 'Lee', phone: '', email: '', status: 'active' }));
    const client = new AutomationPeersClient(fetchImpl);
    expect(await client.user('u1')).toEqual({ id: 'u1', firstName: 'Ann', lastName: 'Lee', phone: undefined, email: undefined, status: 'active' });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/users\/internal\/u1$/);

    const withEmail = new AutomationPeersClient(fakeFetch(async () => response(200, { id: 'u1', email: 'ann@example.com', phone: '+14045550001' })));
    expect(await withEmail.user('u1')).toMatchObject({ email: 'ann@example.com', phone: '+14045550001' });
  });

  it('answers null on 404, on a 5xx and on a network failure', async () => {
    const client404 = new AutomationPeersClient(fakeFetch(async () => response(404)));
    expect(await client404.deal('nope')).toBeNull();
    const client503 = new AutomationPeersClient(fakeFetch(async () => response(503)));
    expect(await client503.user('u1')).toBeNull();
    const clientDown = new AutomationPeersClient(fakeFetch(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await clientDown.deal('d1')).toBeNull();
  });

  it('PUTs a sent-to-tech delivery report onto the internal route', async () => {
    const fetchImpl = fakeFetch(async () => response(200, { recorded: true }));
    const client = new AutomationPeersClient(fetchImpl);
    const report = { techId: 't1', channel: 'sms' as const, status: 'sent' as const, sentAt: '2026-09-16T10:00:00.000Z', messageId: 'm1' };
    expect(await client.reportSentToTech('d1', report)).toBe(true);

    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/deals\/internal\/d1\/sent-to-tech$/);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify(report) });
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ 'content-type': 'application/json', 'x-internal-secret': expect.any(String) });
  });

  it('never throws on a report deal-service refuses or cannot answer — the job is already stamped', async () => {
    expect(await new AutomationPeersClient(fakeFetch(async () => response(404))).reportSentToTech('d1', {
      techId: 't1', channel: 'sms', status: 'sent', sentAt: '2026-09-16T10:00:00.000Z',
    })).toBe(false);
    expect(await new AutomationPeersClient(fakeFetch(async () => { throw new Error('ECONNREFUSED'); })).reportSentToTech('d1', {
      techId: 't1', channel: 'email', status: 'skipped', sentAt: '2026-09-16T10:00:00.000Z', reason: 'no_email',
    })).toBe(false);
  });
});
