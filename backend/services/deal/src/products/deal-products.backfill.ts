import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DealProductsRepository } from './deal-products.repository';

/**
 * Boot-time self-heal: deal line items written before the `fulfillment` field
 * existed carry no value. Readers already default a missing value to `sourced`
 * (the only kind of line that existed then), but we stamp it explicitly so the
 * stored data is consistent and queryable. Idempotent — the repository scan only
 * returns rows still missing the field. Errors are swallowed so a data hiccup
 * can never block startup. Runs automatically on every boot (local dev + prod).
 */
@Injectable()
export class DealProductsBackfill implements OnModuleInit {
  private readonly logger = new Logger(DealProductsBackfill.name);

  constructor(private readonly repository: DealProductsRepository) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.repository.listRowsMissingFulfillment();
      let healed = 0;
      for (const row of rows) {
        await this.repository.setFulfillment(row.dealId, row.productId, 'sourced');
        healed++;
      }
      if (healed > 0) {
        this.logger.log(
          `Backfilled fulfillment='sourced' for ${healed} deal line item(s) on boot`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Deal-product fulfillment backfill on boot failed: ${(err as Error).message}`,
      );
    }
  }
}
