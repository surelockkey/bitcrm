import { EventEmitter } from 'events';
import { installGracefulShutdown } from 'src/lifecycle/graceful-shutdown';

jest.mock('src/tracing/tracing', () => ({ shutdownTracing: jest.fn(async () => undefined) }));

/**
 * The order matters: the HTTP listener must stop before `app.close()` runs the
 * destroy hooks — those close Redis, and a request still being served on the
 * outgoing task then failed with "Connection is closed." (1,095 × 500 in the
 * week of 7 Oct, every one on a deploy).
 */
describe('installGracefulShutdown', () => {
  const order: string[] = [];
  let exit: jest.SpyInstance;
  const listeners = new Map<string, (...a: unknown[]) => void>();

  beforeEach(() => {
    order.length = 0;
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.spyOn(process, 'on').mockImplementation(((event: string, fn: (...a: unknown[]) => void) => {
      listeners.set(event, fn);
      return process;
    }) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  function app() {
    const server = Object.assign(new EventEmitter(), {
      close: jest.fn((cb?: () => void) => {
        order.push('http.close');
        setImmediate(() => cb?.());
      }),
      closeIdleConnections: jest.fn(() => order.push('http.closeIdle')),
    });
    return {
      getHttpServer: () => server,
      close: jest.fn(async () => {
        order.push('app.close');
      }),
    };
  }

  it('waits the drain delay, stops HTTP, then closes the app', async () => {
    const a = app();
    installGracefulShutdown(a as never, { drainMs: 20, graceMs: 2_000 });
    const started = Date.now();
    listeners.get('SIGTERM')!();
    await new Promise((r) => setTimeout(r, 80));

    expect(order).toEqual(['http.close', 'http.closeIdle', 'app.close']);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('still closes the app when the server cannot be closed', async () => {
    const a = app();
    a.getHttpServer().close.mockImplementation(() => {
      throw new Error('ERR_SERVER_NOT_RUNNING');
    });
    installGracefulShutdown(a as never, { drainMs: 0, graceMs: 2_000 });
    listeners.get('SIGTERM')!();
    await new Promise((r) => setTimeout(r, 30));
    expect(a.close).toHaveBeenCalled();
  });
});
