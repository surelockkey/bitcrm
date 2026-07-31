import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { type DealSubStatus, type DealStageGroup } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { JobStatusesRepository } from './job-statuses.repository';
import { type CreateJobStatusDto } from './dto/create-job-status.dto';
import { type UpdateJobStatusDto } from './dto/update-job-status.dto';

@Injectable()
export class JobStatusesService {
  private readonly logger = new Logger(JobStatusesService.name);

  constructor(private readonly repository: JobStatusesRepository) {}

  /**
   * Names are the dispatcher-facing identity, but only within a super-status:
   * the old CRM shows the same label ("In progress") under more than one group,
   * so uniqueness is scoped to `group`, not global.
   */
  private async assertNameAvailable(
    name: string,
    group: DealStageGroup,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.repository.listAll();
    const clash = existing.find(
      (s) =>
        s.id !== excludeId &&
        s.group === group &&
        s.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(
        `A job status named "${clash.name}" already exists under this super-status`,
      );
    }
  }

  async create(dto: CreateJobStatusDto, caller: { id: string }): Promise<DealSubStatus> {
    this.logger.log(`Creating job status "${dto.name}" under ${dto.group}`);
    await this.assertNameAvailable(dto.name, dto.group);

    const now = new Date().toISOString();
    const status: DealSubStatus = {
      id: randomUUID(),
      name: dto.name,
      group: dto.group,
      color: dto.color ?? 'slate',
      priority: dto.priority ?? 0,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(status);
    return status;
  }

  async list(): Promise<DealSubStatus[]> {
    const statuses = await this.repository.listAll();
    return statuses.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<DealSubStatus> {
    const status = await this.repository.get(id);
    if (!status) throw new NotFoundException(`Job status ${id} not found`);
    return status;
  }

  async update(
    id: string,
    dto: UpdateJobStatusDto,
    _caller: { id: string },
  ): Promise<DealSubStatus> {
    const existing = await this.findById(id);
    this.logger.log(`Updating job status ${id}`);

    const nextGroup = dto.group ?? existing.group;
    // Re-check uniqueness whenever the name or its group could move.
    if (dto.name !== undefined || dto.group !== undefined) {
      await this.assertNameAvailable(dto.name ?? existing.name, nextGroup, id);
    }

    const updated: DealSubStatus = {
      ...existing,
      name: dto.name ?? existing.name,
      group: nextGroup,
      color: dto.color ?? existing.color,
      priority: dto.priority ?? existing.priority,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    return updated;
  }

  /**
   * Archive rather than destroy when a deal still references the status —
   * otherwise a historical deal would render a dangling id. Unreferenced
   * statuses are removed outright. Returns which happened so the UI can word
   * its toast correctly.
   */
  async remove(id: string, _caller: { id: string }): Promise<{ archived: boolean }> {
    const existing = await this.findById(id);

    if (await this.repository.isReferencedByDeal(id)) {
      if (existing.active) {
        await this.repository.put({
          ...existing,
          active: false,
          updatedAt: new Date().toISOString(),
        });
      }
      this.logger.log(`Archived job status ${id} — still referenced by at least one deal`);
      return { archived: true };
    }

    await this.repository.remove(id);
    return { archived: false };
  }
}
