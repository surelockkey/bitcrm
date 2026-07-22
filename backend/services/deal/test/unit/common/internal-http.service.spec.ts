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

    it('returns an empty array on error', async () => {
      userGet.mockRejectedValue(new Error('timeout'));
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

    it('treats an unreachable user-service as not assignable', async () => {
      userGet.mockRejectedValue(new Error('timeout'));
      const result = await service.getTechnicianEligibility('tech-1');
      expect(result).toEqual({ technicianId: 'tech-1', assignable: false, jobTypeIds: [], serviceAreaIds: [] });
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
