import { ConnectivityCheckService } from '../../../src/connectivity/connectivity-check.service';
import { Probe } from '../../../src/connectivity/connectivity.types';

const probe = (
  name: string,
  ok: boolean,
  kind: 'redis' | 'http' | 'sqs' = 'redis',
  resources?: Array<{ resource: string; present: boolean }>,
): Probe => ({
  name,
  kind,
  run: async () => ({ ok, resources }),
});

describe('ConnectivityCheckService — bootstrap', () => {
  it('runs probes and updates metrics on bootstrap', async () => {
    const metrics = { update: jest.fn() } as any;
    const svc = new ConnectivityCheckService(
      [probe('redis', true)],
      { serviceName: 'test-svc' },
      metrics,
    );

    await svc.onApplicationBootstrap();

    expect(metrics.update).toHaveBeenCalledTimes(1);
    expect(metrics.update.mock.calls[0][0]).toBe('test-svc');
    expect(metrics.update.mock.calls[0][1]).toHaveLength(1);
    svc.onApplicationShutdown();
  });

  it('does not call process.exit when failing dep is not in failFast', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as any);

    const svc = new ConnectivityCheckService(
      [probe('http-dep', false, 'http')],
      { serviceName: 'test', failFast: ['redis'] },
    );
    await svc.onApplicationBootstrap();

    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
    svc.onApplicationShutdown();
  });

  it('calls process.exit(1) when a failFast dependency is down', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined as never) as any);

    const svc = new ConnectivityCheckService(
      [probe('redis', false, 'redis')],
      { serviceName: 'test', failFast: ['redis'] },
    );
    await svc.onApplicationBootstrap();

    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
    svc.onApplicationShutdown();
  });

  it('schedules a periodic re-check that updates metrics', async () => {
    jest.useFakeTimers();
    const metrics = { update: jest.fn() } as any;

    const svc = new ConnectivityCheckService(
      [probe('redis', true)],
      { serviceName: 'svc', intervalMs: 1000 },
      metrics,
    );

    await svc.onApplicationBootstrap();
    expect(metrics.update).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1000);
    expect(metrics.update).toHaveBeenCalledTimes(2);

    svc.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('does nothing on bootstrap when there are no probes', async () => {
    const metrics = { update: jest.fn() } as any;
    const svc = new ConnectivityCheckService([], { serviceName: 'x' }, metrics);

    await svc.onApplicationBootstrap();

    expect(metrics.update).not.toHaveBeenCalled();
  });
});
