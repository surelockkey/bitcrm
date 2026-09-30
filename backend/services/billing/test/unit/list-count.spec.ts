import { EstimatesService } from 'src/estimates/estimates.service';
import { InvoicesService } from 'src/invoices/invoices.service';

/**
 * Скільки рядків у списку — число, з якого панель робить «Page 2 of 7».
 *
 * Обидва списки білінгу читаються Query по індексу, тож `Select: 'COUNT'`
 * відповідає дешево. Але обидва ще й фільтрують сторінку **після** запиту,
 * коли викликач бачить лише свої роботи: тоді жоден обхід індексу на питання
 * не відповідає, і чесна відповідь — `null`, а не чуже число. Панель у такому
 * разі пише «Page 2» і мовчить про загальну кількість.
 */
function redisStub() {
  const store = new Map<string, string>();
  return {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    },
  };
}

// Нескінфігурований ресурс у getDataScopeFilter означає найсуворіший режим,
// тож диспетчеру треба сказати 'all' явно.
const dispatcher = {
  user: { id: 'u-1', department: 'HQ' },
  perms: { dataScope: { invoices: 'all', estimates: 'all' } },
} as never;

const technician = {
  user: { id: 'tech-1', department: 'Field' },
  perms: { dataScope: { invoices: 'assigned_only', estimates: 'assigned_only' } },
} as never;

describe('InvoicesService.count', () => {
  function make() {
    const repo = { count: jest.fn(), get: jest.fn() };
    const service = new InvoicesService(
      repo as never,
      { listDealIdsByTech: jest.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      redisStub() as never,
    );
    return { service, repo };
  }

  it('counts the ledger for a caller who sees all of it', async () => {
    const { service, repo } = make();
    repo.count.mockResolvedValue({ total: 412, atLeast: false });

    await expect(service.count({} as never, dispatcher)).resolves.toEqual({
      total: 412,
      atLeast: false,
    });
  });

  // Сторінка техніка фільтрується після запиту — число з індексу було б чужим.
  it('answers null for a technician scoped to their own jobs', async () => {
    const { service, repo } = make();

    await expect(service.count({} as never, technician)).resolves.toEqual({
      total: null,
      atLeast: false,
    });
    expect(repo.count).not.toHaveBeenCalled();
  });

  // Одна робота — один інвойс, тож питання зводиться до «чи він є».
  it('answers one or zero for a single job, without counting', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue({ id: 'deal-1', status: 'draft' });

    await expect(service.count({ dealId: 'deal-1' } as never, dispatcher)).resolves.toEqual({
      total: 1,
      atLeast: false,
    });
    expect(repo.count).not.toHaveBeenCalled();
  });

  it('answers zero for a job whose invoice does not match the status filter', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue({ id: 'deal-1', status: 'draft' });

    await expect(
      service.count({ dealId: 'deal-1', status: 'paid' } as never, dispatcher),
    ).resolves.toEqual({ total: 0, atLeast: false });
  });

  it('answers a repeat from the cache', async () => {
    const { service, repo } = make();
    repo.count.mockResolvedValue({ total: 412, atLeast: false });

    await service.count({} as never, dispatcher);
    await service.count({} as never, dispatcher);

    expect(repo.count).toHaveBeenCalledTimes(1);
  });
});

describe('EstimatesService.count', () => {
  function make() {
    const repo = { count: jest.fn() };
    const service = new EstimatesService(
      repo as never,
      { listDealIdsByTech: jest.fn() } as never,
      undefined,
      undefined,
      redisStub() as never,
    );
    return { service, repo };
  }

  it('counts the list for a caller who sees all of it', async () => {
    const { service, repo } = make();
    repo.count.mockResolvedValue({ total: 88, atLeast: false });

    await expect(service.count({} as never, dispatcher)).resolves.toEqual({
      total: 88,
      atLeast: false,
    });
  });

  it('answers null for a technician scoped to their own jobs', async () => {
    const { service, repo } = make();

    await expect(service.count({} as never, technician)).resolves.toEqual({
      total: null,
      atLeast: false,
    });
    expect(repo.count).not.toHaveBeenCalled();
  });

  it('counts again when the filters change', async () => {
    const { service, repo } = make();
    repo.count.mockResolvedValue({ total: 88, atLeast: false });

    await service.count({} as never, dispatcher);
    await service.count({ status: 'approved' } as never, dispatcher);

    expect(repo.count).toHaveBeenCalledTimes(2);
  });
});
