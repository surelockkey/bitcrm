import { ForbiddenException } from '@nestjs/common';
import { TechniciansRepository } from 'src/technicians/technicians.repository';
import { TechniciansService } from 'src/technicians/technicians.service';

/**
 * Скільки техніків у списку — число, з якого панель робить «Page 2 of 7».
 *
 * Це Query по індексу техніків: ключ уже вибирає потрібні рядки, тож нічого не
 * фільтрується після читання й тіла не їдуть по дроту. Дешевий кінець
 * підрахунку — на відміну від списків, що ходять Scan.
 *
 * Хто не має права бачити список, не має права й знати його розмір: кількість
 * теж розповідає про штат.
 */
describe('TechniciansService.count', () => {
  function makeService(privileged = true) {
    const repository = {
      countAll: jest.fn(),
      countByStatus: jest.fn(),
    };
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    };
    const service = new TechniciansService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      redis as never,
    );
    jest
      .spyOn(service as never as { isPrivilegedCaller: () => Promise<boolean> }, 'isPrivilegedCaller')
      .mockResolvedValue(privileged);
    return { service, repository };
  }

  const caller = { id: 'u-1' } as never;

  it('counts the whole roster when no status is picked', async () => {
    const { service, repository } = makeService();
    repository.countAll.mockResolvedValue({ total: 23, atLeast: false });

    await expect(service.count({} as never, caller)).resolves.toEqual({
      total: 23,
      atLeast: false,
    });
  });

  it('counts under the status filter the list uses', async () => {
    const { service, repository } = makeService();
    repository.countByStatus.mockResolvedValue({ total: 5, atLeast: false });

    await expect(service.count({ status: 'active' } as never, caller)).resolves.toEqual({
      total: 5,
      atLeast: false,
    });
    expect(repository.countAll).not.toHaveBeenCalled();
  });

  it('refuses a caller who may not list technicians', async () => {
    const { service, repository } = makeService(false);

    await expect(service.count({} as never, caller)).rejects.toThrow(ForbiddenException);
    expect(repository.countAll).not.toHaveBeenCalled();
  });

  it('answers a repeat from the cache', async () => {
    const { service, repository } = makeService();
    repository.countAll.mockResolvedValue({ total: 23, atLeast: false });

    await service.count({} as never, caller);
    await service.count({} as never, caller);

    expect(repository.countAll).toHaveBeenCalledTimes(1);
  });
});

/**
 * Той самий підрахунок на рівні репозиторію: ключ індексу, `Select: 'COUNT'`,
 * жодного FilterExpression.
 */
describe('TechniciansRepository counting', () => {
  function makeRepository() {
    const send = jest.fn();
    const repository = new TechniciansRepository({ client: { send } } as never);
    return { repository, send };
  }

  it('counts on the technician index without pulling bodies back', async () => {
    const { repository, send } = makeRepository();
    send.mockResolvedValue({ Count: 23 });

    await expect(repository.countAll()).resolves.toEqual({ total: 23, atLeast: false });
    expect(send.mock.calls[0][0].input.Select).toBe('COUNT');
    expect(send.mock.calls[0][0].input.FilterExpression).toBeUndefined();
  });

  it('narrows to a status through the sort key, not a filter', async () => {
    const { repository, send } = makeRepository();
    send.mockResolvedValue({ Count: 5 });

    await repository.countByStatus('active' as never);

    const sent = send.mock.calls[0][0];
    expect(sent.input.KeyConditionExpression).toContain('begins_with(GSI3SK, :sk)');
    expect(sent.input.ExpressionAttributeValues[':sk']).toBe('active#');
    expect(sent.input.FilterExpression).toBeUndefined();
  });

  it('sums across the walk', async () => {
    const { repository, send } = makeRepository();
    send
      .mockResolvedValueOnce({ Count: 20, LastEvaluatedKey: { PK: 'X#1' } })
      .mockResolvedValueOnce({ Count: 3 });

    await expect(repository.countAll()).resolves.toEqual({ total: 23, atLeast: false });
  });
});
