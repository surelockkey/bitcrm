import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BusinessMetricsService } from '@bitcrm/shared';
import {
  CALL_TAG_LIMITS,
  JOB_TAG_COLORS,
  type CallTag,
  type JobTagColor,
} from '@bitcrm/types';
import { CallTagsRepository } from './call-tags.repository';
import {
  type CreateCallTagDto,
  type UpdateCallTagDto,
} from './dto/call-tag.dto';

/** How long a catalog read is reused on the tagging hot path. */
const CACHE_TTL_MS = 15_000;

@Injectable()
export class CallTagsService {
  private readonly logger = new Logger(CallTagsService.name);
  private cache: { value: CallTag[]; expiresAt: number } | null = null;

  constructor(
    private readonly repository: CallTagsRepository,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /* ------------------------------------------------------------ reading */

  /** Every tag, archived included, priority-first then by name. */
  async list(): Promise<CallTag[]> {
    const tags = await this.repository.listAll();
    return tags.sort(
      (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
    );
  }

  async findById(id: string): Promise<CallTag> {
    const tag = await this.repository.get(id);
    if (!tag) throw new NotFoundException(`Call tag ${id} not found`);
    return tag;
  }

  /**
   * The catalog as a map, memoised briefly. Tagging a call checks every id it
   * is given against this, and a dispatcher clearing a queue of spam calls
   * must not cost one catalog Query per click.
   *
   * `refresh` skips the memo. A write only clears the cache of the task that
   * served it, so a tag created on one task is invisible to another for up to
   * CACHE_TTL_MS — and there are always at least two tasks during a rolling
   * deploy. The tagging path re-reads with this before calling an id unknown,
   * which is the difference between the picker's create-then-attach working
   * and a 404 that silently reverts the chip.
   */
  async byId(options?: { refresh?: boolean }): Promise<Map<string, CallTag>> {
    if (options?.refresh || !this.cache || this.cache.expiresAt <= Date.now()) {
      const value = await this.repository.listAll();
      this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return new Map(this.cache.value.map((t) => [t.id, t]));
  }

  /* ------------------------------------------------------------ writing */

  async create(dto: CreateCallTagDto, caller: { id: string }): Promise<CallTag> {
    const name = this.validName(dto?.name);
    await this.assertNameAvailable(name);

    const now = new Date().toISOString();
    const tag: CallTag = {
      id: randomUUID(),
      name,
      color: this.validColor(dto.color) ?? 'slate',
      priority: this.validPriority(dto.priority) ?? 0,
      active: this.validActive(dto.active) ?? true,
      externalId: this.validExternalId(dto.externalId),
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.create(tag);
    this.cache = null;
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'call_tag' });
    this.logger.log(`Call tag "${tag.name}" created`);
    return tag;
  }

  async update(
    id: string,
    dto: UpdateCallTagDto,
    caller: { id: string },
  ): Promise<CallTag> {
    const existing = await this.findById(id);
    const name =
      dto?.name === undefined ? existing.name : this.validName(dto.name);
    if (dto?.name !== undefined) await this.assertNameAvailable(name, id);

    const updated: CallTag = {
      ...existing,
      name,
      color: this.validColor(dto?.color) ?? existing.color,
      priority: this.validPriority(dto?.priority) ?? existing.priority,
      active: this.validActive(dto?.active) ?? existing.active,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    };

    await this.repository.put(updated);
    this.cache = null;
    return updated;
  }

  /**
   * Archive, never delete. Calls keep their `tagIds`, so the name still
   * resolves on every historical row; only the pickers lose the tag. Restore
   * with `update(id, { active: true })`. Idempotent.
   */
  async archive(id: string, caller: { id: string }): Promise<CallTag> {
    const existing = await this.findById(id);
    if (!existing.active) return existing;

    const archived: CallTag = {
      ...existing,
      active: false,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.put(archived);
    this.cache = null;
    this.logger.log(`Call tag ${id} archived by ${caller.id}`);
    return archived;
  }

  /* --------------------------------------------------------- validation */

  /**
   * Two tags called "Spam" would be indistinguishable in every chip and
   * filter — the same rule the job-tag and call-group catalogs apply.
   */
  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const clash = (await this.repository.listAll()).find(
      (t) => t.id !== excludeId && t.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`A call tag named "${clash.name}" already exists`);
    }
  }

  /* No ValidationPipe in this service — the DTO decorators are inert. */

  private validName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw new BadRequestException('name is required');
    if (name.length > CALL_TAG_LIMITS.nameMaxLength) {
      throw new BadRequestException(
        `name must be at most ${CALL_TAG_LIMITS.nameMaxLength} characters`,
      );
    }
    return name;
  }

  private validColor(raw: unknown): JobTagColor | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!JOB_TAG_COLORS.includes(raw as JobTagColor)) {
      throw new BadRequestException(
        `color must be one of ${JOB_TAG_COLORS.join(', ')}`,
      );
    }
    return raw as JobTagColor;
  }

  private validPriority(raw: unknown): number | undefined {
    if (raw === undefined || raw === null) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      throw new BadRequestException('priority must be an integer');
    }
    return n;
  }

  private validActive(raw: unknown): boolean | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'boolean') {
      throw new BadRequestException('active must be true or false');
    }
    return raw;
  }

  private validExternalId(raw: unknown): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string' || raw.length > 120) {
      throw new BadRequestException('externalId must be a short string');
    }
    return raw;
  }
}
