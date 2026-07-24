import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkOrderStatus, type WorkOrder } from '@bitcrm/types';
import { WorkOrdersService } from 'src/work-orders/work-orders.service';

const caller = { id: 'admin-1' };

function wo(over?: Partial<WorkOrder>): WorkOrder {
  return {
    id: 'wo-1', woNumber: 'WO-1', companyId: 'c1', date: '2026-11-05',
    status: WorkOrderStatus.OPEN, createdBy: 'admin-1',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    ...over,
  };
}

describe('WorkOrdersService', () => {
  let repo: {
    create: jest.Mock; listAll: jest.Mock; get: jest.Mock; put: jest.Mock; remove: jest.Mock;
  };
  let s3: { getPresignedUpload: jest.Mock };
  let service: WorkOrdersService;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockResolvedValue(undefined),
      listAll: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(wo()),
      put: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    s3 = { getPresignedUpload: jest.fn().mockResolvedValue({ url: 'https://s3/up', headers: {} }) };
    service = new WorkOrdersService(repo as never, s3 as never);
  });

  describe('create', () => {
    it('creates an OPEN work order', async () => {
      const result = await service.create(
        { woNumber: 'WO-9', companyId: 'c1', date: '2026-11-05' } as never,
        caller,
      );
      expect(result.status).toBe(WorkOrderStatus.OPEN);
      expect(result.woNumber).toBe('WO-9');
      expect(repo.create).toHaveBeenCalled();
    });

    it('rejects a duplicate woNumber (case-insensitive)', async () => {
      repo.listAll.mockResolvedValue([wo({ woNumber: 'WO-9' })]);
      await expect(
        service.create({ woNumber: 'wo-9', companyId: 'c1', date: '2026-11-05' } as never, caller),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('list', () => {
    it('filters by companyId and status', async () => {
      repo.listAll.mockResolvedValue([
        wo({ id: 'a', companyId: 'c1', status: WorkOrderStatus.OPEN }),
        wo({ id: 'b', companyId: 'c2', status: WorkOrderStatus.OPEN }),
        wo({ id: 'c', companyId: 'c1', status: WorkOrderStatus.CLOSED }),
      ]);
      const res = await service.list({ companyId: 'c1', status: WorkOrderStatus.OPEN });
      expect(res.map((w) => w.id)).toEqual(['a']);
    });
  });

  describe('findById', () => {
    it('404s an unknown work order', async () => {
      repo.get.mockResolvedValue(null);
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('archives (not deletes) a work order linked to a deal', async () => {
      repo.get.mockResolvedValue(wo({ dealId: 'deal-1', status: WorkOrderStatus.OPEN }));
      const res = await service.remove('wo-1', caller);
      expect(res).toEqual({ archived: true });
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ status: WorkOrderStatus.ARCHIVED }));
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('hard-deletes a work order with no deal link', async () => {
      repo.get.mockResolvedValue(wo({ dealId: undefined }));
      const res = await service.remove('wo-1', caller);
      expect(res).toEqual({ archived: false });
      expect(repo.remove).toHaveBeenCalledWith('wo-1');
    });
  });

  describe('requestDocumentUpload', () => {
    it('returns a presigned URL and stores the s3Key on the work order', async () => {
      const res = await service.requestDocumentUpload('wo-1', { contentType: 'application/pdf' } as never);
      expect(res.uploadUrl).toBe('https://s3/up');
      expect(s3.getPresignedUpload).toHaveBeenCalledWith('work-orders/wo-1', expect.objectContaining({ contentType: 'application/pdf' }));
      expect(repo.put).toHaveBeenCalledWith(expect.objectContaining({ s3Key: 'work-orders/wo-1' }));
    });
  });
});
