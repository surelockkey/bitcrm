import axios from 'axios';
import { InternalHttpService } from 'src/common/services/internal-http.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InternalHttpService', () => {
  let service: InternalHttpService;
  let crmGet: jest.Mock;
  let crmPost: jest.Mock;
  let userGet: jest.Mock;
  let inventoryPost: jest.Mock;

  beforeEach(() => {
    crmGet = jest.fn();
    crmPost = jest.fn();
    userGet = jest.fn();
    inventoryPost = jest.fn();

    mockedAxios.create.mockImplementation((config: any) => {
      if (config.baseURL?.includes('4002')) return { get: crmGet, post: crmPost } as any;
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

  describe('getContact / getCompany', () => {
    it('reads the contact over the internal CRM route', async () => {
      crmGet.mockResolvedValue({ data: { success: true, data: { id: 'contact-1', taxExempt: true } } });
      const contact = await service.getContact('contact-1');
      expect(contact).toEqual({ id: 'contact-1', taxExempt: true });
      expect(crmGet).toHaveBeenCalledWith('/api/crm/contacts/internal/contact-1');
    });

    it('reads the company over the internal CRM route', async () => {
      crmGet.mockResolvedValue({ data: { success: true, data: { id: 'co-1', taxExempt: false } } });
      const company = await service.getCompany('co-1');
      expect(company).toEqual({ id: 'co-1', taxExempt: false });
      expect(crmGet).toHaveBeenCalledWith('/api/crm/companies/internal/co-1');
    });

    it('returns null on 404 and throws otherwise', async () => {
      crmGet.mockRejectedValueOnce({ response: { status: 404 } });
      expect(await service.getContact('gone')).toBeNull();
      crmGet.mockRejectedValueOnce({ response: { status: 404 } });
      expect(await service.getCompany('gone')).toBeNull();
      crmGet.mockRejectedValueOnce(new Error('down'));
      await expect(service.getCompany('co-1')).rejects.toThrow();
    });
  });

  /**
   * The client names side-loaded with a page of jobs. Names only — crm masks a
   * contact's numbers for a caller without `contacts.view_numbers` and
   * deal-service masks nothing — and never fatal: the page renders without it.
   */
  describe('getContactNames', () => {
    it('posts the deduped ids to the internal names route', async () => {
      crmPost.mockResolvedValue({ data: { success: true, data: [] } });

      await service.getContactNames(['c-1', 'c-2', 'c-1']);

      expect(crmPost).toHaveBeenCalledTimes(1);
      const [path, body] = crmPost.mock.calls[0];
      expect(path).toBe('/api/crm/contacts/internal/names-by-ids');
      expect(body).toEqual({ ids: ['c-1', 'c-2'] });
    });

    it('asks for nothing when there are no ids', async () => {
      expect(await service.getContactNames([])).toEqual([]);
      expect(crmPost).not.toHaveBeenCalled();
    });

    it('never asks for more than crm accepts', async () => {
      crmPost.mockResolvedValue({ data: { data: [] } });

      await service.getContactNames(Array.from({ length: 130 }, (_, i) => `c-${i}`));

      expect(crmPost.mock.calls[0][1].ids).toHaveLength(100);
    });

    it('bounds the wait — the list must not hang on a slow crm', async () => {
      crmPost.mockResolvedValue({ data: { data: [] } });

      await service.getContactNames(['c-1']);

      expect(crmPost.mock.calls[0][2].timeout).toBeGreaterThan(0);
    });

    it('copies out the names and leaves numbers and emails behind', async () => {
      crmPost.mockResolvedValue({
        data: {
          data: [
            { id: 'c-1', firstName: 'Bo', lastName: 'Client', phone: '+14045559999', email: 'bo@x.com' },
          ],
        },
      });

      expect(await service.getContactNames(['c-1'])).toEqual([
        { id: 'c-1', firstName: 'Bo', lastName: 'Client' },
      ]);
    });

    it('answers with an empty list when crm is down, rather than throwing', async () => {
      crmPost.mockRejectedValue(new Error('ECONNREFUSED'));

      expect(await service.getContactNames(['c-1'])).toEqual([]);
    });

    it('answers with an empty list when crm sends nonsense', async () => {
      crmPost.mockResolvedValue({ data: { data: 'not-an-array' } });
      expect(await service.getContactNames(['c-1'])).toEqual([]);

      crmPost.mockResolvedValue({ data: { data: [null, { firstName: 'No id' }] } });
      expect(await service.getContactNames(['c-1'])).toEqual([]);
    });
  });

  /**
   * Names of the people on a dashboard scoreboard. A handful at a time, one
   * lookup each on user-service's internal route; names only, and never fatal —
   * a person it cannot name is simply left out.
   */
  describe('getUserNames', () => {
    it('looks each distinct id up on the internal user route', async () => {
      userGet.mockResolvedValue({ data: { data: { id: 'u-1', firstName: 'Daniel', lastName: 'Munoz' } } });

      await service.getUserNames(['u-1', 'u-1', '']);

      expect(userGet).toHaveBeenCalledTimes(1);
      expect(userGet.mock.calls[0][0]).toBe('/api/users/internal/u-1');
      expect(userGet.mock.calls[0][1].timeout).toBeGreaterThan(0);
    });

    it('copies out the names and nothing else', async () => {
      userGet.mockResolvedValue({
        data: { data: { id: 'u-1', firstName: 'Daniel', lastName: 'Munoz', email: 'd@x.com', phone: '+1404' } },
      });

      expect(await service.getUserNames(['u-1'])).toEqual([{ id: 'u-1', firstName: 'Daniel', lastName: 'Munoz' }]);
    });

    it('a user it cannot fetch is left out, the rest still come back', async () => {
      userGet.mockImplementation(async (path: string) => {
        if (path.endsWith('u-2')) throw new Error('404');
        return { data: { data: { id: 'u-1', firstName: 'Tess', lastName: '' } } };
      });

      expect(await service.getUserNames(['u-1', 'u-2'])).toEqual([{ id: 'u-1', firstName: 'Tess', lastName: '' }]);
    });

    it('asks for nothing when there are no ids', async () => {
      expect(await service.getUserNames([])).toEqual([]);
      expect(userGet).not.toHaveBeenCalled();
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
