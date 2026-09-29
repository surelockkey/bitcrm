import { NotFoundException } from '@nestjs/common';
import { TimelineEventType, type JwtUser } from '@bitcrm/types';
import { DealEquipmentService } from 'src/deals/equipment/deal-equipment.service';

/**
 * Equipment on a job, as Workiz's "Add equipment" form has it: a name and a
 * model, then brand, the two warranties, serial, install date, where in the
 * property and notes. It belongs to the job and to the job's client, and
 * everything that happens to it lands on the job's timeline.
 */
const tech: JwtUser = { id: 'tech-1', cognitoSub: 'sub', email: 't@x.com', roleId: 'role-tech', department: 'Field' };

const job = {
  id: 'd1',
  contactId: 'c1',
  address: { street: '50 Fitch St', city: 'New Haven', state: 'CT', zip: '06515' },
};

const stored = {
  id: 'eq-1',
  dealId: 'd1',
  contactId: 'c1',
  name: 'Garage door opener',
  model: 'LM-8500',
  createdBy: 'tech-1',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};

describe('DealEquipmentService', () => {
  let repo: { create: jest.Mock; get: jest.Mock; listByDeal: jest.Mock; update: jest.Mock; delete: jest.Mock };
  let deals: { findById: jest.Mock };
  let timeline: { addEntry: jest.Mock };
  let service: DealEquipmentService;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(stored),
      listByDeal: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(async (_d, _i, patch) => ({ ...stored, ...patch })),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    deals = { findById: jest.fn().mockResolvedValue(job) };
    timeline = { addEntry: jest.fn().mockResolvedValue(undefined) };
    service = new DealEquipmentService(repo as never, deals as never, timeline as never);
  });

  it('adds equipment to the job and its client, at the job\'s address unless told otherwise', async () => {
    const eq = await service.create('d1', { name: 'Garage door opener', model: 'LM-8500', serial: 'SN1' }, tech);

    expect(eq).toMatchObject({
      dealId: 'd1',
      contactId: 'c1',
      name: 'Garage door opener',
      model: 'LM-8500',
      serial: 'SN1',
      propertyAddress: '50 Fitch St, New Haven, CT 06515',
      createdBy: 'tech-1',
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ id: eq.id, dealId: 'd1' }));
    expect(timeline.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        dealId: 'd1',
        eventType: TimelineEventType.EQUIPMENT_ADDED,
        actorId: 'tech-1',
        details: expect.objectContaining({ equipmentId: eq.id, name: 'Garage door opener' }),
      }),
    );
  });

  it('refuses equipment on a job that does not exist', async () => {
    deals.findById.mockResolvedValue(null);
    await expect(service.create('nope', { name: 'X', model: 'Y' }, tech)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('lists a job\'s equipment in the order it was added', async () => {
    repo.listByDeal.mockResolvedValue([
      { ...stored, id: 'b', createdAt: '2026-09-29T11:00:00.000Z' },
      { ...stored, id: 'a', createdAt: '2026-09-29T09:00:00.000Z' },
    ]);
    expect((await service.list('d1')).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('edits a piece, stamps the change and logs what changed', async () => {
    const eq = await service.update('d1', 'eq-1', { serial: 'SN9', notes: 'Behind the shelf' }, tech);

    expect(repo.update).toHaveBeenCalledWith(
      'd1',
      'eq-1',
      expect.objectContaining({ serial: 'SN9', notes: 'Behind the shelf', updatedAt: expect.any(String) }),
    );
    expect(eq.serial).toBe('SN9');
    expect(timeline.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TimelineEventType.EQUIPMENT_UPDATED,
        details: expect.objectContaining({ equipmentId: 'eq-1', changed: ['serial', 'notes'] }),
      }),
    );
  });

  it('removes a piece and logs it', async () => {
    await service.delete('d1', 'eq-1', tech);

    expect(repo.delete).toHaveBeenCalledWith('d1', 'eq-1');
    expect(timeline.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: TimelineEventType.EQUIPMENT_REMOVED, details: expect.objectContaining({ name: 'Garage door opener' }) }),
    );
  });

  it('says so when the piece is not on the job', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.update('d1', 'gone', { serial: 'x' }, tech)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('d1', 'gone', tech)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never lets history block the change itself', async () => {
    timeline.addEntry.mockRejectedValue(new Error('dynamo down'));
    await expect(service.create('d1', { name: 'X', model: 'Y' }, tech)).resolves.toBeTruthy();
  });
});
