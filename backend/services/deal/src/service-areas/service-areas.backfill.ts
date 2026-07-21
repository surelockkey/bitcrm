import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GeocodingService } from '@bitcrm/shared';
import { ServiceAreasRepository } from './service-areas.repository';
import { deriveCoverage } from './service-areas.coverage';

/**
 * Boot-time self-heal: recompute `coverage` for any service area whose derived
 * geometry is missing or empty (e.g. rows seeded before geocoding succeeded, or
 * a geometry-model change). Idempotent; skips rows that already have coverage.
 * A geocoding outage is swallowed so it can never block startup.
 */
@Injectable()
export class ServiceAreasBackfill implements OnModuleInit {
  private readonly logger = new Logger(ServiceAreasBackfill.name);

  constructor(
    private readonly repository: ServiceAreasRepository,
    private readonly geocoding: GeocodingService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const areas = await this.repository.listAll();
      const stale = areas.filter((a) => !a.coverage || a.coverage.length === 0);
      let healed = 0;
      for (const area of stale) {
        try {
          const coverage = await deriveCoverage(area.definition, (zip) =>
            this.geocoding.geocode({ street: '', city: '', state: '', zip }),
          );
          if (coverage.length > 0) {
            await this.repository.put({ ...area, coverage, updatedAt: new Date().toISOString() });
            healed++;
          }
        } catch (err) {
          this.logger.warn(`Could not recompute coverage for area ${area.id}: ${(err as Error).message}`);
        }
      }
      if (healed > 0) {
        this.logger.log(`Recomputed coverage for ${healed} service area(s) on boot`);
      }
    } catch (err) {
      this.logger.warn(`Service-area coverage backfill on boot failed: ${(err as Error).message}`);
    }
  }
}
