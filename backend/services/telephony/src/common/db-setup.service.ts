import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ensureCallsGsi2 } from '../scripts/ensure-gsi2';

/**
 * Runs the calls-table schema migration (AllCallsIndex GSI + key backfill)
 * automatically at service startup — CI has no migration step, so boot is the
 * one place that reliably runs in both local dev and production. The migration
 * is idempotent and cheap when there's nothing to do (one DescribeTable + one
 * filtered Scan that matches nothing).
 *
 * Opt out with TELEPHONY_DB_SETUP=false (e.g. when an operator manages the
 * schema out-of-band).
 */
@Injectable()
export class DbSetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DbSetupService.name);

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.TELEPHONY_DB_SETUP === 'false') {
      this.logger.log('DB setup skipped (TELEPHONY_DB_SETUP=false)');
      return;
    }
    try {
      const result = await ensureCallsGsi2({
        log: (msg) => this.logger.log(`ensure-gsi2: ${msg}`),
      });
      this.logger.log(
        `Calls table ready — indexCreated=${result.indexCreated} ` +
          `partyIndexCreated=${result.partyIndexCreated} ` +
          `itemsBackfilled=${result.itemsBackfilled}`,
      );
    } catch (error) {
      // Don't block boot: voice webhooks + token minting still work; only the
      // global list would be degraded, and the next boot retries.
      this.logger.error(
        `Calls table migration failed (service continues): ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
