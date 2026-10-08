/**
 * `GET /deals` side-load — the `included` block that ships the names a page of
 * jobs refers to, so the browser stops making two more round trips (and the
 * one for clients could not even start until the jobs came back).
 *
 * Two sources, both asked only for the distinct ids actually on the page:
 * technicians come free from deal-service's own eligibility projection, and
 * clients from one internal call into crm.
 *
 * **Names only.** No phones, no emails — crm masks a contact's numbers per
 * caller via `contacts.view_numbers` and deal-service masks nothing, so a
 * number carried here would reach every holder of `deals.view`.
 *
 * And it can never cost the page: a source that is down, slow or answering
 * nonsense costs its own array, nothing else.
 */
import { DealsController } from 'src/deals/deals.controller';
import { DealsService } from 'src/deals/deals.service';
import {
  createMockDeal,
  createMockInternalHttpService,
  createMockJwtUser,
  createMockTechnicianEligibilityRepository,
} from '../mocks';

type Eligibility = ReturnType<typeof createMockTechnicianEligibilityRepository>;
type InternalHttp = ReturnType<typeof createMockInternalHttpService>;

function serviceWith(eligibility: Eligibility, internalHttp: InternalHttp): DealsService {
  const stub = {} as any;
  return new DealsService(
    stub, stub, stub, stub,
    internalHttp as any,
    stub, stub, stub, stub, stub, stub, stub, stub,
    eligibility as any,
  );
}

function techRow(id: string, firstName: string, lastName: string) {
  return {
    technicianId: id,
    firstName,
    lastName,
    jobTypeIds: ['jt-1'],
    serviceAreaIds: ['area-1'],
    assignable: true,
    department: 'Field',
    homeAddress: { lat: 33.7, lng: -84.4 },
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('DealsService.includedFor', () => {
  let eligibility: Eligibility;
  let internalHttp: InternalHttp;
  let service: DealsService;

  beforeEach(() => {
    eligibility = createMockTechnicianEligibilityRepository();
    internalHttp = createMockInternalHttpService();
    eligibility.getMany.mockResolvedValue([]);
    internalHttp.getContactNames.mockResolvedValue([]);
    service = serviceWith(eligibility, internalHttp);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('asks each source once per distinct id, however many jobs repeat it', async () => {
    const deals = [
      createMockDeal({ id: 'd1', contactId: 'c-1', assignedTechIds: ['t-1', 't-2'] }),
      createMockDeal({ id: 'd2', contactId: 'c-1', assignedTechIds: ['t-2'] }),
      createMockDeal({ id: 'd3', contactId: 'c-2', assignedTechIds: ['t-1'] }),
    ];

    await service.includedFor(deals);

    expect(eligibility.getMany).toHaveBeenCalledTimes(1);
    expect([...eligibility.getMany.mock.calls[0][0]].sort()).toEqual(['t-1', 't-2']);
    expect(internalHttp.getContactNames).toHaveBeenCalledTimes(1);
    expect([...internalHttp.getContactNames.mock.calls[0][0]].sort()).toEqual(['c-1', 'c-2']);
  });

  it('returns the names of both sources under one `included`', async () => {
    eligibility.getMany.mockResolvedValue([techRow('t-1', 'Ana', 'Tech')]);
    internalHttp.getContactNames.mockResolvedValue([
      { id: 'c-1', firstName: 'Bo', lastName: 'Client' },
    ]);

    const included = await service.includedFor([
      createMockDeal({ contactId: 'c-1', assignedTechIds: ['t-1'] }),
    ]);

    expect(included).toEqual({
      technicians: [{ id: 't-1', firstName: 'Ana', lastName: 'Tech' }],
      clients: [{ id: 'c-1', firstName: 'Bo', lastName: 'Client' }],
    });
  });

  /**
   * Workiz prints its whole name for a technician ("(2) TX - Daniel Munoz") on
   * every Tech chip; the projection keeps it for an imported person, and it
   * travels with the name — on technicians only, and only when there is one.
   */
  it('carries a technician’s Workiz name when the projection holds one', async () => {
    eligibility.getMany.mockResolvedValue([
      { ...techRow('t-1', 'Daniel', 'Munoz'), workizName: '(2) TX - Daniel Munoz' },
      techRow('t-2', 'Ana', 'Tech'),
    ]);
    internalHttp.getContactNames.mockResolvedValue([
      { id: 'c-1', firstName: 'Bo', lastName: 'Client', workizName: 'not a client field' } as any,
    ]);

    const included = await service.includedFor([
      createMockDeal({ contactId: 'c-1', assignedTechIds: ['t-1', 't-2'] }),
    ]);

    expect(included.technicians).toEqual([
      { id: 't-1', firstName: 'Daniel', lastName: 'Munoz', workizName: '(2) TX - Daniel Munoz' },
      { id: 't-2', firstName: 'Ana', lastName: 'Tech' },
    ]);
    expect(included.technicians[1]).not.toHaveProperty('workizName');
    expect(included.clients).toEqual([{ id: 'c-1', firstName: 'Bo', lastName: 'Client' }]);
  });

  // Клієнти не чекають на техніків: обидва джерела питаються одночасно.
  it('asks crm without waiting for the technician read', async () => {
    let releaseTechs: (rows: unknown[]) => void = () => undefined;
    eligibility.getMany.mockReturnValue(
      new Promise((resolve) => {
        releaseTechs = resolve as (rows: unknown[]) => void;
      }),
    );

    const pending = service.includedFor([
      createMockDeal({ contactId: 'c-1', assignedTechIds: ['t-1'] }),
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(internalHttp.getContactNames).toHaveBeenCalled();

    releaseTechs([]);
    await pending;
  });

  it('still answers with a page when crm is down', async () => {
    eligibility.getMany.mockResolvedValue([techRow('t-1', 'Ana', 'Tech')]);
    internalHttp.getContactNames.mockRejectedValue(new Error('ECONNREFUSED'));

    const included = await service.includedFor([
      createMockDeal({ contactId: 'c-1', assignedTechIds: ['t-1'] }),
    ]);

    expect(included.clients).toEqual([]);
    expect(included.technicians).toEqual([{ id: 't-1', firstName: 'Ana', lastName: 'Tech' }]);
  });

  it('still answers with a page when the projection read throws', async () => {
    eligibility.getMany.mockRejectedValue(new Error('ProvisionedThroughputExceeded'));
    internalHttp.getContactNames.mockResolvedValue([
      { id: 'c-1', firstName: 'Bo', lastName: 'Client' },
    ]);

    const included = await service.includedFor([
      createMockDeal({ contactId: 'c-1', assignedTechIds: ['t-1'] }),
    ]);

    expect(included.technicians).toEqual([]);
    expect(included.clients).toEqual([{ id: 'c-1', firstName: 'Bo', lastName: 'Client' }]);
  });

  it('asks for nothing at all on an empty page', async () => {
    const included = await service.includedFor([]);

    expect(included).toEqual({ technicians: [], clients: [] });
    expect(eligibility.getMany).not.toHaveBeenCalled();
    expect(internalHttp.getContactNames).not.toHaveBeenCalled();
  });

  it('skips the source a page has no ids for', async () => {
    await service.includedFor([
      createMockDeal({ contactId: 'c-1', assignedTechIds: [] }),
    ]);

    expect(eligibility.getMany).not.toHaveBeenCalled();
    expect(internalHttp.getContactNames).toHaveBeenCalledWith(['c-1']);
  });

  // Номери й пошта маскуються в crm, а не тут — тож сюди вони не потрапляють.
  it('never carries a phone or an email, whatever the sources send', async () => {
    eligibility.getMany.mockResolvedValue([
      { ...techRow('t-1', 'Ana', 'Tech'), phone: '+14045551234', email: 'ana@example.com' },
    ]);
    internalHttp.getContactNames.mockResolvedValue([
      {
        id: 'c-1',
        firstName: 'Bo',
        lastName: 'Client',
        phone: '+14045559999',
        phones: ['+14045559999'],
        email: 'bo@example.com',
      } as any,
    ]);

    const included = await service.includedFor([
      createMockDeal({ contactId: 'c-1', assignedTechIds: ['t-1'] }),
    ]);

    for (const person of [...included.technicians, ...included.clients]) {
      expect(Object.keys(person).sort()).toEqual(['firstName', 'id', 'lastName']);
    }
  });

  it('caps what it asks for — a page can never name more than 100 of either', async () => {
    const deals = Array.from({ length: 120 }, (_, i) =>
      createMockDeal({ id: `d${i}`, contactId: `c-${i}`, assignedTechIds: [`t-${i}`] }),
    );

    await service.includedFor(deals);

    expect(eligibility.getMany.mock.calls[0][0]).toHaveLength(100);
    expect(internalHttp.getContactNames.mock.calls[0][0]).toHaveLength(100);
  });

  it('drops a job with no client rather than asking for a blank id', async () => {
    await service.includedFor([
      createMockDeal({ contactId: undefined as any, assignedTechIds: [undefined as any, 't-1'] }),
    ]);

    expect(internalHttp.getContactNames).not.toHaveBeenCalled();
    expect(eligibility.getMany).toHaveBeenCalledWith(['t-1']);
  });
});

describe('DealsController.list', () => {
  it('sends the names with the page', async () => {
    const deals = [createMockDeal()];
    const included = {
      technicians: [{ id: 't-1', firstName: 'Ana', lastName: 'Tech' }],
      clients: [{ id: 'c-1', firstName: 'Bo', lastName: 'Client' }],
    };
    const service = {
      list: jest.fn().mockResolvedValue({ items: deals, nextCursor: 'next' }),
      includedFor: jest.fn().mockResolvedValue(included),
    };
    const controller = new DealsController(service as any);

    const result = await controller.list({} as any, createMockJwtUser(), {} as any);

    expect(result).toEqual({
      success: true,
      data: deals,
      pagination: { nextCursor: 'next', count: 1 },
      included,
    });
    expect(service.includedFor).toHaveBeenCalledWith(deals);
  });
});
