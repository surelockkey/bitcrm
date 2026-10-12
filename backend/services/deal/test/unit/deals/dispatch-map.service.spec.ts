/**
 * `DispatchMapService.read` — what `GET /deals/map` answers: the jobs the
 * board draws, and beside them who those jobs name, so the browser makes no
 * second round trip (it used to drain the list, THEN ask crm for the clients).
 *
 * - the data scope holds: an `assigned_only` caller (a technician) gets only
 *   the jobs they are on, as on the jobs list;
 * - a job's own numbers travel only to a caller with `contacts.view_numbers`
 *   (the Jobs report's rule); the clients' numbers and emails are asked of crm
 *   AS THE CALLER, so crm masks them exactly as on its own screens;
 * - technicians come from the eligibility projection, names only;
 * - neither side-load can cost the map: a source that fails costs its names.
 */
import { BadRequestException } from '@nestjs/common';
import { JobSuperStatus, type Contact } from '@bitcrm/types';
import { DispatchMapService } from 'src/deals/map/dispatch-map.service';
import {
  createMockDeal,
  createMockInternalHttpService,
  createMockJwtUser,
  createMockTechnicianEligibilityRepository,
} from '../mocks';

const OPEN = [
  JobSuperStatus.SUBMITTED,
  JobSuperStatus.IN_PROGRESS,
  JobSuperStatus.PENDING,
  JobSuperStatus.DONE_PENDING_APPROVAL,
];

function contact(id: string, over: Partial<Contact> = {}): Contact {
  return {
    id,
    firstName: `First-${id}`,
    lastName: `Last-${id}`,
    phones: [`+1404555${id.replace(/\D/g, '').padStart(4, '0')}`],
    emails: [`${id}@example.test`],
    addresses: [],
    notes: 'never on the map',
    ...over,
  } as Contact;
}

describe('DispatchMapService.read', () => {
  let repository: { readMapJobs: jest.Mock };
  let internalHttp: ReturnType<typeof createMockInternalHttpService>;
  let eligibility: ReturnType<typeof createMockTechnicianEligibilityRepository>;
  let service: DispatchMapService;
  const caller = createMockJwtUser({ id: 'tech-me' });
  const allowed = { numbers: true, authorization: 'Bearer caller-token' };

  beforeEach(() => {
    repository = { readMapJobs: jest.fn().mockResolvedValue([]) };
    internalHttp = createMockInternalHttpService();
    eligibility = createMockTechnicianEligibilityRepository();
    service = new DispatchMapService(repository as any, internalHttp as any, eligibility as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('reads the four open statuses whole by default', async () => {
    await service.read({}, caller, 'all', allowed);

    expect(repository.readMapJobs).toHaveBeenCalledWith(
      OPEN.map((status) => ({ status })),
      { techId: undefined },
    );
  });

  it('reads Done / Canceled only for the window asked, beside open statuses read whole', async () => {
    await service.read({ statuses: 'pending,done,canceled', from: '2026-10-11', to: '2026-10-17' }, caller, 'all', allowed);

    const window = { from: '2026-10-11', to: '2026-10-17' };
    // In the board's (Workiz's) status order: Done sits between In progress and Pending.
    expect(repository.readMapJobs).toHaveBeenCalledWith(
      [
        { status: JobSuperStatus.DONE, window },
        { status: JobSuperStatus.PENDING },
        { status: JobSuperStatus.CANCELED, window },
      ],
      { techId: undefined },
    );
  });

  it('refuses Done without a window before reading anything', async () => {
    await expect(service.read({ statuses: 'done' }, caller, 'all', allowed)).rejects.toThrow(BadRequestException);
    expect(repository.readMapJobs).not.toHaveBeenCalled();
  });

  it('holds an `assigned_only` caller to the jobs they are on', async () => {
    await service.read({}, caller, 'assigned_only', allowed);

    expect(repository.readMapJobs).toHaveBeenCalledWith(expect.any(Array), { techId: 'tech-me' });
  });

  it('a job’s own numbers go only to a caller who may see numbers', async () => {
    repository.readMapJobs.mockResolvedValue([createMockDeal({ id: 'd1', phones: ['+14045550100'] })]);

    const shown = await service.read({}, caller, 'all', allowed);
    const masked = await service.read({}, caller, 'all', { ...allowed, numbers: false });

    expect(shown.deals[0].phones).toEqual(['+14045550100']);
    expect(masked.deals[0]).not.toHaveProperty('phones');
    expect(masked.deals[0].id).toBe('d1');
  });

  it('a job’s own first number ("This job only") likewise', async () => {
    repository.readMapJobs.mockResolvedValue([createMockDeal({ id: 'd1', clientPhone: '+12035550123' })]);

    const shown = await service.read({}, caller, 'all', allowed);
    const masked = await service.read({}, caller, 'all', { ...allowed, numbers: false });

    expect(shown.deals[0].clientPhone).toBe('+12035550123');
    expect(masked.deals[0]).not.toHaveProperty('clientPhone');
  });

  it('carries the clients as crm shows them to the caller — names, numbers, emails, masked as crm masks', async () => {
    repository.readMapJobs.mockResolvedValue([
      createMockDeal({ id: 'd1', contactId: 'c1' }),
      createMockDeal({ id: 'd2', contactId: 'c2' }),
      createMockDeal({ id: 'd3', contactId: 'c1' }),
    ]);
    internalHttp.getContactsAsCaller.mockResolvedValue([
      contact('c1'),
      contact('c2', { phones: [], phonesMasked: true, phoneCount: 2 } as Partial<Contact>),
    ]);

    const { included } = await service.read({}, caller, 'all', allowed);

    expect(internalHttp.getContactsAsCaller).toHaveBeenCalledTimes(1);
    expect(internalHttp.getContactsAsCaller).toHaveBeenCalledWith(['c1', 'c2'], 'Bearer caller-token');
    expect(included.clients).toEqual([
      { id: 'c1', firstName: 'First-c1', lastName: 'Last-c1', phones: ['+14045550001'], emails: ['c1@example.test'] },
      { id: 'c2', firstName: 'First-c2', lastName: 'Last-c2', phones: [], emails: ['c2@example.test'], phonesMasked: true },
    ]);
    expect(internalHttp.getContactNames).not.toHaveBeenCalled();
  });

  it('names the clients crm would not show the caller, without their numbers', async () => {
    repository.readMapJobs.mockResolvedValue([
      createMockDeal({ id: 'd1', contactId: 'c1' }),
      createMockDeal({ id: 'd2', contactId: 'c2' }),
    ]);
    internalHttp.getContactsAsCaller.mockResolvedValue([contact('c1')]);
    internalHttp.getContactNames.mockResolvedValue([{ id: 'c2', firstName: 'Bo', lastName: 'Named' }]);

    const { included } = await service.read({}, caller, 'all', allowed);

    expect(internalHttp.getContactNames).toHaveBeenCalledWith(['c2']);
    expect(included.clients.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(included.clients[1]).toEqual({ id: 'c2', firstName: 'Bo', lastName: 'Named', phones: [], emails: [] });
  });

  it('asks crm a hundred clients a body, the bodies at once', async () => {
    const deals = Array.from({ length: 250 }, (_, i) => createMockDeal({ id: `d${i}`, contactId: `c${i}` }));
    repository.readMapJobs.mockResolvedValue(deals);
    internalHttp.getContactsAsCaller.mockImplementation(async (ids: string[]) => ids.map((id) => contact(id)));

    const { included } = await service.read({}, caller, 'all', allowed);

    const bodies = internalHttp.getContactsAsCaller.mock.calls.map((c: any[]) => c[0].length);
    expect(bodies).toEqual([100, 100, 50]);
    expect(included.clients).toHaveLength(250);
  });

  it('names the technicians on the jobs from the eligibility projection — names only', async () => {
    repository.readMapJobs.mockResolvedValue([
      createMockDeal({ id: 'd1', assignedTechIds: ['t1', 't2'] }),
      createMockDeal({ id: 'd2', assignedTechIds: ['t2'] }),
    ]);
    eligibility.getMany.mockResolvedValue([
      { technicianId: 't1', firstName: 'Daniel', lastName: 'Munoz', workizName: '(2) TX - Daniel Munoz', department: 'Field', homeAddress: { lat: 1, lng: 2 }, jobTypeIds: [], serviceAreaIds: [], assignable: true, updatedAt: '' },
      { technicianId: 't2', firstName: 'Ana', lastName: 'Tech', jobTypeIds: [], serviceAreaIds: [], assignable: true, updatedAt: '' },
    ]);

    const { included } = await service.read({}, caller, 'all', allowed);

    expect(eligibility.getMany).toHaveBeenCalledWith(['t1', 't2']);
    expect(included.technicians).toEqual([
      { id: 't1', firstName: 'Daniel', lastName: 'Munoz', workizName: '(2) TX - Daniel Munoz' },
      { id: 't2', firstName: 'Ana', lastName: 'Tech' },
    ]);
  });

  it('a side-load that fails costs its names, never the map', async () => {
    repository.readMapJobs.mockResolvedValue([createMockDeal({ id: 'd1', contactId: 'c1', assignedTechIds: ['t1'] })]);
    eligibility.getMany.mockRejectedValue(new Error('dynamo down'));
    internalHttp.getContactsAsCaller.mockResolvedValue([]);
    internalHttp.getContactNames.mockResolvedValue([]);

    const result = await service.read({}, caller, 'all', allowed);

    expect(result.deals.map((d) => d.id)).toEqual(['d1']);
    expect(result.included).toEqual({ technicians: [], clients: [] });
  });

  it('asks nobody about an empty map', async () => {
    const result = await service.read({}, caller, 'all', allowed);

    expect(result).toEqual({ deals: [], included: { technicians: [], clients: [] } });
    expect(internalHttp.getContactsAsCaller).not.toHaveBeenCalled();
    expect(eligibility.getMany).not.toHaveBeenCalled();
  });
});
