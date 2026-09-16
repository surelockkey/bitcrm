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

  it('reads the user slice and treats a blank phone as absent', async () => {
    const fetchImpl = fakeFetch(async () => response(200, { id: 'u1', firstName: 'Ann', lastName: 'Lee', phone: '', status: 'active' }));
    const client = new AutomationPeersClient(fetchImpl);
    expect(await client.user('u1')).toEqual({ id: 'u1', firstName: 'Ann', lastName: 'Lee', phone: undefined, status: 'active' });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/users\/internal\/u1$/);
  });

  it('answers null on 404, on a 5xx and on a network failure', async () => {
    const client404 = new AutomationPeersClient(fakeFetch(async () => response(404)));
    expect(await client404.deal('nope')).toBeNull();
    const client503 = new AutomationPeersClient(fakeFetch(async () => response(503)));
    expect(await client503.user('u1')).toBeNull();
    const clientDown = new AutomationPeersClient(fakeFetch(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await clientDown.deal('d1')).toBeNull();
  });
});
