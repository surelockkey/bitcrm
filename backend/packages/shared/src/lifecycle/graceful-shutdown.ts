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
 * Stop cleanly on SIGTERM/SIGINT, and stop regardless if that takes too long.
 */
export function installGracefulShutdown(app: INestApplication): void {
  let stopping = false;

  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;

    // Armed before the work starts, so a hang can't outlive it. `unref` keeps
    // this timer from being the thing holding the process open.
    const forced = setTimeout(() => {
      console.warn(
        `[shutdown] ${signal}: still closing after ${SHUTDOWN_GRACE_MS}ms — exiting anyway`,
      );
      process.exit(0);
    }, SHUTDOWN_GRACE_MS);
    forced.unref();

    try {
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
