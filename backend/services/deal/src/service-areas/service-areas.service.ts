import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService, GeocodingService } from '@bitcrm/shared';
import {
  ServiceAreaType,
  type ServiceArea,
  type ServiceAreaDefinition,
  type CoverageShape,
  type GeoPoint,
  type ZipEntry,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { ServiceAreasRepository } from './service-areas.repository';
import { deriveCoverage, type ZipGeocoder } from './service-areas.coverage';
import { pointInCoverage } from './geo/point-in-area';
import { coveragesOverlap } from './geo/overlap';
import { type CreateServiceAreaDto } from './dto/create-service-area.dto';
import { type UpdateServiceAreaDto } from './dto/update-service-area.dto';
import { type PreviewServiceAreaDto } from './dto/preview-service-area.dto';
import { type ResolveServiceAreaDto } from './dto/resolve-service-area.dto';

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

    const now = new Date().toISOString();
    const area: ServiceArea = {
      id: randomUUID(),
      name: dto.name,
      priority: dto.priority ?? 0,
      active,
      type: dto.type,
      definition,
      coverage,
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
      type: definition.type,
      definition,
      coverage,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.publishEvent('service-area.updated', { serviceAreaId: id, name: updated.name });
    return updated;
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
