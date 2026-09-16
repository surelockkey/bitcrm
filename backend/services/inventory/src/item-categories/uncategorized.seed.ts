import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UNCATEGORIZED_CATEGORY } from '@bitcrm/types';
import { ItemCategoriesRepository } from './item-categories.repository';
import { ItemCategoriesService } from './item-categories.service';

/**
 * Boot-time self-heal for the `Uncategorized` sentinel. The Workiz importer
 * writes `category: "Uncategorized"` on the 13 195 price-book items that have
 * no category, but (by default) no matching `ITEM_CATEGORY#` catalog row. If
 * any product references the sentinel and the catalog lacks it, seed the row
 * so the picker lists it and the archive-on-delete rule keeps resolving it.
 * Idempotent (nothing referenced or already seeded → no write); errors are
 * swallowed so a data hiccup can never block startup.
 */
@Injectable()
export class UncategorizedCategorySeed implements OnModuleInit {
  private readonly logger = new Logger(UncategorizedCategorySeed.name);

  constructor(
    private readonly repository: ItemCategoriesRepository,
    private readonly categories: ItemCategoriesService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      if (!(await this.repository.isReferencedByProduct(UNCATEGORIZED_CATEGORY))) {
        return;
      }
      const { created } = await this.categories.ensureUncategorized();
      if (created) {
        this.logger.log(
          `Seeded the "${UNCATEGORIZED_CATEGORY}" item category on boot — products reference it`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Uncategorized category seed on boot failed: ${(err as Error).message}`,
      );
    }
  }
}
