import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { type JobType } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { JobTypesRepository } from './job-types.repository';
import { type CreateJobTypeDto } from './dto/create-job-type.dto';
import { type UpdateJobTypeDto } from './dto/update-job-type.dto';

@Injectable()
export class JobTypesService {
  private readonly logger = new Logger(JobTypesService.name);

  constructor(
    private readonly repository: JobTypesRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * Names are the dispatcher-facing identity, so two types called "Rekey" would
   * be indistinguishable in every picker. This is the job-type analogue of the
   * service-area overlap check.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (t) => t.id !== excludeId && t.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A job type named "${clash.name}" already exists`);
    }
  }

  async create(dto: CreateJobTypeDto, caller: { id: string }): Promise<JobType> {
    this.logger.log(`Creating job type "${dto.name}"`);
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const jobType: JobType = {
      id: randomUUID(),
      name: dto.name,
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(jobType);
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'job_type' });
    this.publishEvent('job-type.created', { jobTypeId: jobType.id, name: jobType.name });
    return jobType;
  }

  async list(): Promise<JobType[]> {
    const jobTypes = await this.repository.listAll();
    return jobTypes.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<JobType> {
    const jobType = await this.repository.get(id);
    if (!jobType) throw new NotFoundException(`Job type ${id} not found`);
    return jobType;
  }

  async update(id: string, dto: UpdateJobTypeDto, caller: { id: string }): Promise<JobType> {
    const existing = await this.findById(id);
    this.logger.log(`Updating job type ${id}`);

    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const updated: JobType = {
      ...existing,
      name: dto.name ?? existing.name,
      priority: dto.priority ?? existing.priority,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.publishEvent('job-type.updated', { jobTypeId: id, name: updated.name });
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
      this.publishEvent('job-type.archived', { jobTypeId: id, archivedBy: caller.id });
      this.logger.log(`Archived job type ${id} — still referenced by at least one deal`);
      return { archived: true };
    }

    await this.repository.remove(id);
    this.publishEvent('job-type.deleted', { jobTypeId: id, deletedBy: caller.id });
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
