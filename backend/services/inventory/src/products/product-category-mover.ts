import { Injectable, Logger, Optional } from '@nestjs/common';
import { SnsPublisherService } from '@bitcrm/shared';
import { publishInventoryEvent } from '../common/events/publish-inventory-event';
import { ProductsRepository } from './products.repository';
import { ProductsCacheService } from './products-cache.service';

/** Products read per page of the old category partition (one bare Query each). */
const MOVE_PAGE_SIZE = 100;
/** Product writes in flight at once — a 1 876-item category moves in seconds, not a minute. */
const MOVE_CONCURRENCY = 25;

/**
 * Moves products from one category NAME to another — what a category rename
 * has to do, because a product stores its category by name (`category`, and
 * `GSI1PK = CATEGORY#<name>`), not by id. Without it the items stay filed
 * under the old name, which no catalog row carries any more.
 *
 * Each product goes through `ProductsRepository.update`, so GSI1 is rebuilt
 * and the other indexes re-file as on any edit; its cache entry is dropped and
 * the search index is told (`product.updated` — search shows the category).
 * Not audit-logged per item: it is one catalog edit, not N item edits.
 *
 * Idempotent: a moved product has left the old partition, so a move that
 * failed half-way is finished by running it again.
 */
@Injectable()
export class ProductCategoryMover {
  private readonly logger = new Logger(ProductCategoryMover.name);

  constructor(
    private readonly repository: ProductsRepository,
    private readonly cache: ProductsCacheService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
  ) {}

  /** Move every product filed under `from` to `to`; answers how many moved. */
  async move(from: string, to: string): Promise<number> {
    if (from === to) return 0;

    let moved = 0;
    let cursor: string | undefined;
    do {
      // Paged by key: rows already moved have left the partition, the cursor
      // still points past them, so nothing is read twice or skipped.
      const page = await this.repository.findByCategory(from, MOVE_PAGE_SIZE, cursor);
      for (let i = 0; i < page.items.length; i += MOVE_CONCURRENCY) {
        await Promise.all(
          page.items.slice(i, i + MOVE_CONCURRENCY).map(async (product) => {
            await this.repository.update(product.id, { category: to });
            await this.cache.invalidate(product.id);
            publishInventoryEvent(this.snsPublisher, this.logger, 'product.updated', {
              productId: product.id,
            });
          }),
        );
      }
      moved += page.items.length;
      cursor = page.nextCursor;
    } while (cursor);

    if (moved > 0) this.logger.log(`Moved ${moved} product(s) from category "${from}" to "${to}"`);
    return moved;
  }
}
