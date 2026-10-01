import axios from 'axios';
import { InternalHttpService } from 'src/common/services/internal-http.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('InternalHttpService — what the Jobs report asks of user and crm', () => {
  let service: InternalHttpService;
  let userPost: jest.Mock;
  let crmInternalPost: jest.Mock;
  let crmAsCallerPost: jest.Mock;
  let configs: any[];

  beforeEach(() => {
    userPost = jest.fn();
    crmInternalPost = jest.fn();
    crmAsCallerPost = jest.fn();
    configs = [];
    mockedAxios.create.mockImplementation((config: any) => {
      configs.push(config);
      if (config.baseURL?.includes('4001')) return { get: jest.fn(), post: userPost } as any;
      if (config.baseURL?.includes('4002')) {
        return { get: jest.fn(), post: config.headers?.['x-internal-secret'] ? crmInternalPost : crmAsCallerPost } as any;
      }
      return { get: jest.fn(), post: jest.fn() } as any;
    });
    service = new InternalHttpService();
  });

  it('names users 200 to a body, in parallel, and keeps names only', async () => {
    userPost.mockImplementation(async (_url: string, body: { userIds: string[] }) => ({
      data: { data: body.userIds.map((id) => ({ id, firstName: 'F', lastName: id, email: 'secret@x' })) },
    }));
    const ids = Array.from({ length: 450 }, (_, i) => `u${i}`);
    const names = await service.getUserNamesBatch([...ids, 'u1', '']);
    expect(userPost).toHaveBeenCalledTimes(3);
    expect(userPost.mock.calls[0][0]).toBe('/api/users/internal/names-by-ids');
    expect(userPost.mock.calls.map((c) => c[1].userIds.length)).toEqual([200, 200, 50]);
    expect(names).toHaveLength(450);
    expect(names[0]).toEqual({ id: 'u0', firstName: 'F', lastName: 'u0' });
  });

  it('a failed batch costs its names, not the others', async () => {
    userPost.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: { data: [{ id: 'u200', firstName: 'A', lastName: 'B' }] } });
    const names = await service.getUserNamesBatch(Array.from({ length: 201 }, (_, i) => `u${i}`));
    expect(names).toEqual([{ id: 'u200', firstName: 'A', lastName: 'B' }]);
  });

  it('asks crm for contacts with the caller\'s own token, never the internal secret', async () => {
    crmAsCallerPost.mockResolvedValue({ data: { data: [{ id: 'c1', phones: [], phonesMasked: true, emails: ['a@b.c'] }] } });
    const contacts = await service.getContactsAsCaller(['c1', 'c1'], 'Bearer user-token');
    expect(crmAsCallerPost).toHaveBeenCalledWith('/api/crm/contacts/by-ids', { ids: ['c1'] }, expect.objectContaining({ headers: { authorization: 'Bearer user-token' } }));
    expect(crmInternalPost).not.toHaveBeenCalled();
    const asCaller = configs.find((c) => c.baseURL?.includes('4002') && !c.headers);
    expect(asCaller).toBeDefined();
    expect(contacts[0].phonesMasked).toBe(true);
  });

  it('answers nothing without a token or when crm refuses', async () => {
    await expect(service.getContactsAsCaller(['c1'], undefined)).resolves.toEqual([]);
    crmAsCallerPost.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
    await expect(service.getContactsAsCaller(['c1'], 'Bearer t')).resolves.toEqual([]);
  });
});
