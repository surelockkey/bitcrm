import { type INestApplication } from '@nestjs/common';
import { shutdownTracing } from '../tracing/tracing';

/**
 * How long a tidy shutdown gets before the process is ended anyway.
 *
 * Not a nicety — this is what keeps a service from hanging on SIGTERM. Nest's
 * `app.close()` waits for open connections to drain, and a keep-alive
 * connection that has gone half-open (the peer vanished without a FIN, which
 * Docker Desktop's port forwarding does routinely) never drains. In production
 * nothing notices, because the orchestrator follows SIGTERM with SIGKILL. In a
 * `--watch` dev loop nobody sends the second signal: the old process sits
 * there forever holding nothing, the watcher waits for it to exit before
 * starting the replacement, and the service is simply gone until somebody
 * kills it by hand.
 */
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 5_000);

/**
 * How long a stopping task keeps serving before it closes its listener.
 *
 * ECS sends SIGTERM at the same moment it starts taking the task out of
 * Service Connect, so for a moment peers still route requests here. Answering
 * them normally for a short while is cheaper than refusing them. Off in
 * development, where nothing routes around a restart.
 */
const SHUTDOWN_DRAIN_MS = Number(
  process.env.SHUTDOWN_DRAIN_MS ?? (process.env.NODE_ENV === 'production' ? 3_000 : 0),
);

export interface GracefulShutdownOptions {
  drainMs?: number;
  graceMs?: number;
}

/** Stop accepting connections and drop the idle keep-alive ones; resolves once in-flight requests ended. */
function closeHttp(app: INestApplication, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = setTimeout(resolve, timeoutMs);
    done.unref();
    try {
      const server = app.getHttpServer() as {
        close: (cb?: (err?: Error) => void) => void;
        closeIdleConnections?: () => void;
      };
      server.close(() => {
        clearTimeout(done);
        resolve();
      });
      server.closeIdleConnections?.();
    } catch {
      clearTimeout(done);
      resolve();
    }
  });
}

/**
 * Stop cleanly on SIGTERM/SIGINT, and stop regardless if that takes too long.
 *
 * The order is the point: keep serving for the drain delay, close the HTTP
 * listener and let in-flight requests finish, and only then `app.close()`.
 * Nest runs the destroy hooks (Redis `quit()`, among others) BEFORE it closes
 * the HTTP server, so calling `app.close()` first left requests that were
 * still being served with a closed Redis.
 */
export function installGracefulShutdown(
  app: INestApplication,
  options: GracefulShutdownOptions = {},
): void {
  const drainMs = options.drainMs ?? SHUTDOWN_DRAIN_MS;
  const graceMs = options.graceMs ?? SHUTDOWN_GRACE_MS;
  let stopping = false;

  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;

    // Armed before the work starts, so a hang can't outlive it. `unref` keeps
    // this timer from being the thing holding the process open.
    const forced = setTimeout(() => {
      console.warn(
        `[shutdown] ${signal}: still closing after ${drainMs + graceMs}ms — exiting anyway`,
      );
      process.exit(0);
    }, drainMs + graceMs);
    forced.unref();

    try {
      if (drainMs > 0) await new Promise((r) => setTimeout(r, drainMs));
      await closeHttp(app, Math.max(graceMs - 1_000, 500));
      await app.close();
      await shutdownTracing();
    } catch (error) {
      console.warn(`[shutdown] ${signal}: ${(error as Error)?.message ?? error}`);
    } finally {
      clearTimeout(forced);
      process.exit(0);
    }
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => void stop(signal));
  }
}

/**
 * Run a service's bootstrap, and end the process if it fails.
 *
 * Without this a rejected bootstrap is an unhandled rejection over a process
 * that stays alive on its open handles — which reads, from the outside,
 * exactly like a healthy service that has stopped answering.
 */
export function runBootstrap(bootstrap: () => Promise<unknown>): void {
  bootstrap().catch((error: unknown) => {
    console.error('[bootstrap] failed to start:', error);
    process.exit(1);
  });
}
