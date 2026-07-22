import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { type JobSource } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { JobSourcesRepository } from './job-sources.repository';
import { type CreateJobSourceDto } from './dto/create-job-source.dto';
import { type UpdateJobSourceDto } from './dto/update-job-source.dto';

@Injectable()
export class JobSourcesService {
  private readonly logger = new Logger(JobSourcesService.name);

  constructor(
    private readonly repository: JobSourcesRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * Names are the dispatcher-facing identity, so two types called "Rekey" would
   * be indistinguishable in every picker. This is the job-source analogue of the
   * service-area overlap check.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (t) => t.id !== excludeId && t.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A job source named "${clash.name}" already exists`);
    }
  }

  async create(dto: CreateJobSourceDto, caller: { id: string }): Promise<JobSource> {
    this.logger.log(`Creating job source "${dto.name}"`);
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const jobSource: JobSource = {
      id: randomUUID(),
      name: dto.name,
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(jobSource);
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'job_source' });
    this.publishEvent('job-source.created', { jobSourceId: jobSource.id, name: jobSource.name });
    return jobSource;
  }

  async list(): Promise<JobSource[]> {
    const jobSources = await this.repository.listAll();
    return jobSources.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<JobSource> {
    const jobSource = await this.repository.get(id);
    if (!jobSource) throw new NotFoundException(`Job source ${id} not found`);
    return jobSource;
  }

  async update(id: string, dto: UpdateJobSourceDto, caller: { id: string }): Promise<JobSource> {
    const existing = await this.findById(id);
    this.logger.log(`Updating job source ${id}`);

    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const updated: JobSource = {
      ...existing,
      name: dto.name ?? existing.name,
      priority: dto.priority ?? existing.priority,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.publishEvent('job-source.updated', { jobSourceId: id, name: updated.name });
    return updated;
  }

  /**
   * Archive rather than destroy when deals still reference the type — otherwise
   * historical deals would render a dangling id. Unreferenced types are removed
   * outright so a typo doesn't linger in the catalog forever.
   *
   * Returns which of the two happened so the UI can word its toast correctly.
   */
  async remove(id: string, caller: { id: string }): Promise<{ archived: boolean }> {
    const existing = await this.findById(id);

    if (await this.repository.isReferencedByDeal(id)) {
      if (existing.active) {
        await this.repository.put({
          ...existing,
          active: false,
          updatedAt: new Date().toISOString(),
        });
      }
      this.publishEvent('job-source.archived', { jobSourceId: id, archivedBy: caller.id });
      this.logger.log(`Archived job source ${id} — still referenced by at least one deal`);
      return { archived: true };
    }

    await this.repository.remove(id);
    this.publishEvent('job-source.deleted', { jobSourceId: id, deletedBy: caller.id });
    return { archived: false };
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
