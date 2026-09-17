import axios from 'axios';
import { InternalHttpService } from 'src/common/services/internal-http.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InternalHttpService', () => {
  let service: InternalHttpService;
  let crmGet: jest.Mock;
  let userGet: jest.Mock;
  let inventoryPost: jest.Mock;

  beforeEach(() => {
    crmGet = jest.fn();
    userGet = jest.fn();
    inventoryPost = jest.fn();

    mockedAxios.create.mockImplementation((config: any) => {
      if (config.baseURL?.includes('4002')) return { get: crmGet, post: jest.fn() } as any;
      if (config.baseURL?.includes('4001')) return { get: userGet, post: jest.fn() } as any;
      if (config.baseURL?.includes('4004')) return { get: jest.fn(), post: inventoryPost } as any;
      return {} as any;
    });

    service = new InternalHttpService();
  });

  describe('validateContact', () => {
    it('should return true when contact exists', async () => {
      crmGet.mockResolvedValue({ data: { success: true } });
      const result = await service.validateContact('contact-1');
      expect(result).toBe(true);
      expect(crmGet).toHaveBeenCalledWith('/api/crm/contacts/internal/contact-1');
    });

    it('should return false when contact not found (404)', async () => {
      crmGet.mockRejectedValue({ response: { status: 404 } });
      const result = await service.validateContact('nonexistent');
      expect(result).toBe(false);
    });

    it('should throw on other errors', async () => {
      crmGet.mockRejectedValue(new Error('Connection refused'));
      await expect(service.validateContact('contact-1')).rejects.toThrow('Connection refused');
    });
  });

  describe('listAssignableTechnicians', () => {
    it('returns the assignable technicians from user service', async () => {
      const techs = [{ technicianId: 'tech-1', assignable: true, jobTypeIds: ['jt-1'], serviceAreaIds: ['sa-1'] }];
      userGet.mockResolvedValue({ data: { data: techs } });

      const result = await service.listAssignableTechnicians();

      expect(result).toEqual(techs);
      expect(userGet).toHaveBeenCalledWith('/api/users/internal/technicians/assignable');
    });

    /**
     * Null, not `[]`. The caller reconciles the eligibility projection against
     * this list and removes what is missing from it, so "user-service could
     * not answer" has to be distinguishable from "there are no technicians" —
     * otherwise one timeout empties the assignment dialog.
     */
    it('returns null when user-service cannot answer', async () => {
      userGet.mockRejectedValue(new Error('timeout'));
      expect(await service.listAssignableTechnicians()).toBeNull();
    });

    it('returns an empty list when user-service really has no technicians', async () => {
      userGet.mockResolvedValue({ data: { data: [] } });
      expect(await service.listAssignableTechnicians()).toEqual([]);
    });
  });

  describe('getTechnicianEligibility', () => {
    it('returns a single technician’s eligibility', async () => {
      const eligibility = { technicianId: 'tech-1', assignable: true, jobTypeIds: ['jt-1'], serviceAreaIds: ['sa-1'] };
      userGet.mockResolvedValue({ data: { data: eligibility } });

      const result = await service.getTechnicianEligibility('tech-1');

      expect(result).toEqual(eligibility);
      expect(userGet).toHaveBeenCalledWith('/api/users/internal/technicians/tech-1/eligibility');
    });

    /**
     * "Not assignable" is acted on by deleting the projection row, so an
     * unreachable user-service must not be able to say it: a single timeout
     * would take a working technician out of dispatch until the next boot.
     * The throw is what lets SQS redeliver instead.
     */
    it('throws when user-service cannot answer', async () => {
      userGet.mockRejectedValue(new Error('timeout'));
      await expect(service.getTechnicianEligibility('tech-1')).rejects.toThrow();
    });

    it('treats a 404 as a real "not a technician" answer', async () => {
      userGet.mockRejectedValue({ response: { status: 404 } });
      const result = await service.getTechnicianEligibility('ghost');
      expect(result).toEqual({ technicianId: 'ghost', assignable: false, jobTypeIds: [], serviceAreaIds: [] });
    });
  });

  describe('deductStock', () => {
    it('should post to inventory service', async () => {
      inventoryPost.mockResolvedValue({});
      const dto = {
        containerId: 'c-1', items: [{ productId: 'p-1', productName: 'Bolt', quantity: 1 }],
        dealId: 'd-1', performedBy: 'u-1', performedByName: 'test',
      };
      await service.deductStock(dto);
      expect(inventoryPost).toHaveBeenCalledWith('/api/inventory/transfers/internal/stock/deduct', dto);
    });

    it('should surface a downstream 4xx with its status and message (not a 500)', async () => {
      inventoryPost.mockRejectedValue({
        response: { status: 400, data: { error: { message: 'Insufficient stock for product p-1' } } },
      });
      const dto = {
        containerId: 'c-1', items: [{ productId: 'p-1', productName: 'Bolt', quantity: 1 }],
        dealId: 'd-1', performedBy: 'u-1', performedByName: 'test',
      };
      await expect(service.deductStock(dto)).rejects.toMatchObject({
        status: 400,
        message: 'Insufficient stock for product p-1',
      });
    });

    it('should map a network/5xx failure to a 502', async () => {
      inventoryPost.mockRejectedValue(new Error('ECONNREFUSED'));
      const dto = {
        containerId: 'c-1', items: [{ productId: 'p-1', productName: 'Bolt', quantity: 1 }],
        dealId: 'd-1', performedBy: 'u-1', performedByName: 'test',
      };
      await expect(service.deductStock(dto)).rejects.toMatchObject({ status: 502 });
    });
  });

  describe('restoreStock', () => {
    it('should post to inventory service', async () => {
      inventoryPost.mockResolvedValue({});
      const dto = {
        containerId: 'c-1', items: [{ productId: 'p-1', productName: 'Bolt', quantity: 1 }],
        dealId: 'd-1', performedBy: 'u-1', performedByName: 'test',
      };
      await service.restoreStock(dto);
      expect(inventoryPost).toHaveBeenCalledWith('/api/inventory/transfers/internal/stock/restore', dto);
    });
  });
});
