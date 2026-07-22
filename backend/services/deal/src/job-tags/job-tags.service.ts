import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { SnsPublisherService, BusinessMetricsService } from '@bitcrm/shared';
import { type JobTag } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { JobTagsRepository } from './job-tags.repository';
import { type CreateJobTagDto } from './dto/create-job-tag.dto';
import { type UpdateJobTagDto } from './dto/update-job-tag.dto';

@Injectable()
export class JobTagsService {
  private readonly logger = new Logger(JobTagsService.name);

  constructor(
    private readonly repository: JobTagsRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /**
   * Names are the dispatcher-facing identity, so two types called "Rekey" would
   * be indistinguishable in every picker. This is the job-tag analogue of the
   * service-area overlap check.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (t) => t.id !== excludeId && t.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A job tag named "${clash.name}" already exists`);
    }
  }

  async create(dto: CreateJobTagDto, caller: { id: string }): Promise<JobTag> {
    this.logger.log(`Creating job tag "${dto.name}"`);
    await this.assertNameAvailable(dto.name);

    const now = new Date().toISOString();
    const jobTag: JobTag = {
      id: randomUUID(),
      name: dto.name,
      color: dto.color ?? 'slate',
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(jobTag);
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'job_tag' });
    this.publishEvent('job-tag.created', { jobTagId: jobTag.id, name: jobTag.name });
    return jobTag;
  }

  async list(): Promise<JobTag[]> {
    const jobTags = await this.repository.listAll();
    return jobTags.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<JobTag> {
    const jobTag = await this.repository.get(id);
    if (!jobTag) throw new NotFoundException(`Job tag ${id} not found`);
    return jobTag;
  }

  async update(id: string, dto: UpdateJobTagDto, caller: { id: string }): Promise<JobTag> {
    const existing = await this.findById(id);
    this.logger.log(`Updating job tag ${id}`);

    if (dto.name !== undefined) await this.assertNameAvailable(dto.name, id);

    const updated: JobTag = {
      ...existing,
      name: dto.name ?? existing.name,
      color: dto.color ?? existing.color,
      priority: dto.priority ?? existing.priority,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.publishEvent('job-tag.updated', { jobTagId: id, name: updated.name });
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
      this.publishEvent('job-tag.archived', { jobTagId: id, archivedBy: caller.id });
      this.logger.log(`Archived job tag ${id} — still referenced by at least one deal`);
      return { archived: true };
    }

    await this.repository.remove(id);
    this.publishEvent('job-tag.deleted', { jobTagId: id, deletedBy: caller.id });
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
