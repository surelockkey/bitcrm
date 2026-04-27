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

  describe('getTechnicians', () => {
    it('should return technicians from user service', async () => {
      const techs = [{ id: 'tech-1', firstName: 'John' }];
      userGet.mockResolvedValue({ data: { data: techs } });

      const result = await service.getTechnicians({ serviceArea: 'Atlanta', skill: 'lockout' });

      expect(result).toEqual(techs);
      expect(userGet).toHaveBeenCalledWith('/api/users/internal/technicians', {
        params: { serviceArea: 'Atlanta', skill: 'lockout' },
      });
    });

    it('should return empty array on error', async () => {
      userGet.mockRejectedValue(new Error('timeout'));
      const result = await service.getTechnicians();
      expect(result).toEqual([]);
    });

    it('should pass no params when no filters', async () => {
      userGet.mockResolvedValue({ data: { data: [] } });
      await service.getTechnicians();
      expect(userGet).toHaveBeenCalledWith('/api/users/internal/technicians', { params: {} });
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
