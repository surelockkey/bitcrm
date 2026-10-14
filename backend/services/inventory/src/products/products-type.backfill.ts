import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ProductType } from '@bitcrm/types';
import { ProductsRepository } from './products.repository';

/**
 * Boot-time self-heal: products created before the product/service `type` axis
 * existed carry no `type` (and therefore no `TypeIndex` GSI2 keys), so they are
 * invisible to type filters and would slip past the service non-stockable guard.
 * Default them to `product` — `repository.update` also rebuilds their GSI2 keys.
 * Idempotent: rows that already have a `type` are skipped. Runs on boot (local
 * dev + prod) until one complete walk has been recorded (`PRODUCTTYPEHEAL /
 * STATE`); after that a boot costs one GetItem. Every product BitCRM writes
 * carries a type, so a recorded walk stays true — delete the row to walk again
 * (e.g. after an import that wrote untyped rows). The walk reads the whole
 * ~16k-row catalog: on every task start it was a CPU burst on a half-vCPU
 * task, right when the first requests arrive. Errors are swallowed so a data
 * hiccup can never block startup (and a failed walk is not recorded).
 */
@Injectable()
export class ProductsTypeBackfill implements OnModuleInit {
  private readonly logger = new Logger(ProductsTypeBackfill.name);

  constructor(private readonly repository: ProductsRepository) {}

  async onModuleInit(): Promise<void> {
    try {
      if (await this.repository.typeHealDone()) return;
      let cursor: string | undefined;
      let healed = 0;
      do {
        const page = await this.repository.findAll(100, cursor);
        for (const product of page.items) {
          if (!product.type) {
            await this.repository.update(product.id, { type: ProductType.PRODUCT });
            healed++;
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
      await this.repository.markTypeHealDone();
      if (healed > 0) {
        this.logger.log(
          `Backfilled type='product' for ${healed} untyped product(s) on boot`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Product type backfill on boot failed: ${(err as Error).message}`,
      );
    }
  }
}
