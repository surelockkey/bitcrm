import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService, GeocodingService, tryNormalizePhone } from '@bitcrm/shared';
import {
  ServiceAreaType,
  DEFAULT_TIMEZONE,
  type ServiceArea,
  type ServiceAreaDefinition,
  type CoverageShape,
  type GeoPoint,
  type ZipEntry,
  type ServiceAreaTax,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ServiceAreasRepository } from './service-areas.repository';
import { deriveCoverage, type ZipGeocoder } from './service-areas.coverage';
import { pointInCoverage } from './geo/point-in-area';
import { distanceToCoverageMiles } from './geo/distance-to-area';
import { coveragesOverlap } from './geo/overlap';
import { type CreateServiceAreaDto } from './dto/create-service-area.dto';
import { type UpdateServiceAreaDto } from './dto/update-service-area.dto';
import { type PreviewServiceAreaDto } from './dto/preview-service-area.dto';
import { type ResolveServiceAreaDto } from './dto/resolve-service-area.dto';
import { BusinessProfilesClient } from '../common/services/business-profiles.client';

interface GeometryInput {
  type: ServiceAreaType;
  zips?: ZipEntry[];
  vertices?: GeoPoint[];
}

@Injectable()
export class ServiceAreasService {
  private readonly logger = new Logger(ServiceAreasService.name);

  constructor(
    private readonly repository: ServiceAreasRepository,
    private readonly geocoding: GeocodingService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly businessProfiles?: BusinessProfilesClient,
  ) {}

  /** ZIP → centroid via the shared geocoder (empty other fields → ZIP-only query). */
  private geocodeZip: ZipGeocoder = (zip: string) =>
    this.geocoding.geocode({ street: '', city: '', state: '', zip });

  private buildDefinition(input: GeometryInput): ServiceAreaDefinition {
    if (input.type === ServiceAreaType.POLYGON) {
      if (!input.vertices?.length) {
        throw new BadRequestException('vertices are required for a polygon service area');
      }
      return { type: ServiceAreaType.POLYGON, vertices: input.vertices };
    }
    if (!input.zips?.length) {
      throw new BadRequestException('zips are required for a zip service area');
    }
    return { type: ServiceAreaType.ZIPS, zips: input.zips };
  }

  /** Reject a coverage that intersects any OTHER active area. */
  private async assertNoOverlap(coverage: CoverageShape[], excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    for (const area of existing) {
      if (area.id === excludeId || !area.active) continue;
      if (coveragesOverlap(coverage, area.coverage)) {
        throw new ConflictException(
          `Service area overlaps existing area "${area.name}" (${area.id})`,
        );
      }
    }
  }

  async create(dto: CreateServiceAreaDto, caller: { id: string }): Promise<ServiceArea> {
    this.logger.log(`Creating service area "${dto.name}" (type=${dto.type})`);
    const definition = this.buildDefinition(dto);
    const coverage = await deriveCoverage(definition, this.geocodeZip);

    const active = dto.active ?? true;
    if (active) await this.assertNoOverlap(coverage);
    const tax = this.normalizeTax(dto.tax);
    const defaultBusinessProfileId = await this.validateCompany(dto.defaultBusinessProfileId);

    const now = new Date().toISOString();
    const area: ServiceArea = {
      id: randomUUID(),
      name: dto.name,
      priority: dto.priority ?? 0,
      active,
      timezone: dto.timezone || DEFAULT_TIMEZONE,
      type: dto.type,
      definition,
      coverage,
      ...(this.normalizeCallerId(dto.callerId) ?? {}),
      ...(tax && { tax }),
      ...(defaultBusinessProfileId && { defaultBusinessProfileId }),
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(area);
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'service_area' });
    this.publishEvent('service-area.created', { serviceAreaId: area.id, name: area.name });
    return area;
  }

  async list(): Promise<ServiceArea[]> {
    const areas = await this.repository.listAll();
    return areas.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<ServiceArea> {
    const area = await this.repository.get(id);
    if (!area) throw new NotFoundException(`Service area ${id} not found`);
    return area;
  }

  async update(id: string, dto: UpdateServiceAreaDto, caller: { id: string }): Promise<ServiceArea> {
    const existing = await this.findById(id);
    this.logger.log(`Updating service area ${id}`);

    const geometryChanged = dto.type !== undefined || dto.zips !== undefined || dto.vertices !== undefined;
    let { definition, coverage } = existing;
    if (geometryChanged) {
      definition = this.buildDefinition({
        type: dto.type ?? existing.type,
        zips: dto.zips ?? (existing.definition.type === ServiceAreaType.ZIPS ? existing.definition.zips : undefined),
        vertices: dto.vertices ?? (existing.definition.type === ServiceAreaType.POLYGON ? existing.definition.vertices : undefined),
      });
      coverage = await deriveCoverage(definition, this.geocodeZip);
    }

    const active = dto.active ?? existing.active;
    if (active) await this.assertNoOverlap(coverage, id);

    const updated: ServiceArea = {
      ...existing,
      name: dto.name ?? existing.name,
      priority: dto.priority ?? existing.priority,
      active,
      timezone: dto.timezone || existing.timezone || DEFAULT_TIMEZONE,
      type: definition.type,
      definition,
      coverage,
      updatedAt: new Date().toISOString(),
    };

    // Not `?? existing`: the whole point is that an operator can UNSET the
    // number, and a nullish coalesce can only ever set one.
    if (dto.callerId !== undefined) {
      const normalized = this.normalizeCallerId(dto.callerId);
      if (normalized) updated.callerId = normalized.callerId;
      else delete updated.callerId;
    }

    // undefined keeps the stored tax; null clears it (jobs then carry no tax).
    // Existing jobs keep their snapshot either way.
    if (dto.tax !== undefined) {
      const tax = this.normalizeTax(dto.tax);
      if (tax) updated.tax = tax;
      else delete updated.tax;
    }

    // undefined keeps the stored company; null / '' clears it.
    if (dto.defaultBusinessProfileId !== undefined) {
      const companyId = await this.validateCompany(dto.defaultBusinessProfileId);
      if (companyId) updated.defaultBusinessProfileId = companyId;
      else delete updated.defaultBusinessProfileId;
    }

    await this.repository.put(updated);
    this.publishEvent('service-area.updated', { serviceAreaId: id, name: updated.name });
    return updated;
  }

  /**
   * Normalise and validate a market caller id, or `undefined` to clear it.
   *
   * Rejected at SAVE time deliberately. Caller id is never checked against
   * account ownership at dial time — `pickCallerId` in telephony is a regex
   * sanity filter and says so — meaning a typo would otherwise surface three
   * weeks later as a client whose call hangs up.
   */
  private normalizeCallerId(
    raw: string | null | undefined,
  ): { callerId: string } | undefined {
    if (raw === undefined || raw === null || raw.trim() === '') return undefined;
    const normalized = tryNormalizePhone(raw);
    if (!normalized) {
      throw new BadRequestException(
        `callerId "${raw}" is not a valid phone number`,
      );
    }
    return { callerId: normalized };
  }

  /**
   * Validate an area's tax (the DTO decorators do most of this, but services
   * are also called directly): name 1–60 after trimming, rate 0–100 with at
   * most 3 decimals. Returns undefined for "no tax" (null).
   */
  private normalizeTax(raw: { name?: unknown; ratePercent?: unknown } | null | undefined): ServiceAreaTax | undefined {
    if (raw === undefined || raw === null) return undefined;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name.length < 1 || name.length > 60) {
      throw new BadRequestException('tax.name must be 1–60 characters');
    }
    const rate = raw.ratePercent;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException('tax.ratePercent must be a number between 0 and 100');
    }
    const scaled = rate * 1000;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
      throw new BadRequestException('tax.ratePercent may have at most 3 decimal places');
    }
    return { name, ratePercent: rate };
  }

  /**
   * An area's default company must be an active billing company. Returns the
   * id to store, or undefined for "none" (null / blank). Billing being down is
   * not an error — the client accepts the id and logs a warning.
   */
  private async validateCompany(raw: string | null | undefined): Promise<string | undefined> {
    if (raw === undefined || raw === null || raw.trim() === '') return undefined;
    if (!this.businessProfiles) return raw;
    return (await this.businessProfiles.resolve(raw.trim())).id;
  }

  async remove(id: string, caller: { id: string }): Promise<void> {
    await this.findById(id);
    await this.repository.remove(id);
    this.publishEvent('service-area.deleted', { serviceAreaId: id, deletedBy: caller.id });
  }

  /** Derive coverage for an unsaved definition (map preview) without persisting. */
  async preview(dto: PreviewServiceAreaDto): Promise<CoverageShape[]> {
    const definition = this.buildDefinition(dto);
    return deriveCoverage(definition, this.geocodeZip);
  }

  /** The single active area containing `point`, or null. */
  async resolvePoint(point: GeoPoint): Promise<ServiceArea | null> {
    const areas = await this.repository.listAll();
    const matches = areas
      .filter((a) => a.active && pointInCoverage(point, a.coverage))
      .sort((a, b) => b.priority - a.priority);
    return matches[0] ?? null;
  }

  /** Resolve from explicit coordinates or an address (coordinates win). */
  async resolve(dto: ResolveServiceAreaDto): Promise<ServiceArea | null> {
    const point = await this.pointFromInput(dto);
    if (!point) return null;
    return this.resolvePoint(point);
  }

  /**
   * The active area closest to a point — the answer for an address nobody
   * serves. Inside an area this degenerates to resolve (distance 0); ties
   * break by priority, like resolve does.
   */
  async nearest(
    dto: ResolveServiceAreaDto,
  ): Promise<{ area: ServiceArea; distanceMiles: number } | null> {
    const point = await this.pointFromInput(dto);
    if (!point) return null;
    const areas = await this.repository.listAll();
    const ranked = areas
      .filter((a) => a.active)
      .map((area) => ({ area, distanceMiles: distanceToCoverageMiles(point, area.coverage) }))
      .filter((r) => Number.isFinite(r.distanceMiles))
      .sort(
        (a, b) =>
          a.distanceMiles - b.distanceMiles || b.area.priority - a.area.priority,
      );
    if (!ranked.length) return null;
    const { area, distanceMiles } = ranked[0];
    return { area, distanceMiles: Math.round(distanceMiles * 10) / 10 };
  }

  private async pointFromInput(dto: ResolveServiceAreaDto): Promise<GeoPoint | null> {
    if (dto.lat !== undefined && dto.lng !== undefined) {
      return { lat: dto.lat, lng: dto.lng };
    }
    if (dto.address) {
      return this.geocoding.geocode(dto.address);
    }
    throw new BadRequestException('Provide either lat/lng or an address to resolve');
  }

  private publishEvent(eventType: string, payload: Record<string, unknown>): void {
    this.snsPublisher
      ?.publish('deal-events', eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished?.inc({ event_type: eventType }))
      .catch((error: Error) => {
        this.businessMetrics?.eventsFailed?.inc({ event_type: eventType });
        this.logger.warn(`Failed to publish ${eventType}: ${error.message}`);
      });
  }
}
