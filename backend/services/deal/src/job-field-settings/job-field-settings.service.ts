import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_JOB_FIELD_SETTINGS,
  JOB_REQUIRABLE_FIELDS,
  type JobFieldSettings,
  type JwtUser,
} from '@bitcrm/types';
import { JobFieldSettingsRepository } from './job-field-settings.repository';
import { type CreateDealDto } from '../deals/dto/create-deal.dto';

const KNOWN_IDS = new Set<string>(JOB_REQUIRABLE_FIELDS.map((f) => f.id));

/**
 * How a create body answers each requirable field. Client phone/email live on
 * the contact, not the deal — the form enforces those; the server can't.
 */
const FILLED: Partial<Record<string, (dto: CreateDealDto) => boolean>> = {
  address: (dto) => Boolean(dto.address?.street?.trim()),
  serviceArea: (dto) => Boolean(dto.serviceArea?.trim()),
  jobType: (dto) => Boolean(dto.jobTypeId),
  source: (dto) => Boolean(dto.sourceId),
  scheduled: (dto) => Boolean(dto.scheduledDate),
  description: (dto) => Boolean(dto.notes?.trim()),
  poNumber: (dto) => Boolean(dto.poNumber?.trim()),
  tags: (dto) => Boolean(dto.tagIds?.length),
};

/** Admin-configured "which job fields are required" (Settings → Job Fields). */
@Injectable()
export class JobFieldSettingsService {
  private readonly logger = new Logger(JobFieldSettingsService.name);

  constructor(private readonly repository: JobFieldSettingsRepository) {}

  /** Stored choices merged over the defaults; unknown ids dropped. */
  async get(): Promise<JobFieldSettings> {
    const stored = await this.repository.get();
    const requiredFields: Record<string, boolean> = {};
    for (const f of JOB_REQUIRABLE_FIELDS) {
      const v = stored?.requiredFields[f.id];
      requiredFields[f.id] =
        typeof v === 'boolean' ? v : (DEFAULT_JOB_FIELD_SETTINGS.requiredFields[f.id] ?? false);
    }
    return { requiredFields };
  }

  async update(dto: JobFieldSettings, caller: JwtUser): Promise<JobFieldSettings> {
    const unknown = Object.keys(dto.requiredFields ?? {}).filter((id) => !KNOWN_IDS.has(id));
    if (unknown.length) {
      throw new BadRequestException(`Unknown job field id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    }
    const current = await this.get();
    const next: JobFieldSettings = {
      requiredFields: { ...current.requiredFields, ...dto.requiredFields },
    };
    await this.repository.put(next);
    this.logger.log(`Job field settings updated by ${caller.id}`);
    return next;
  }

  /** Which admin-required fields this create body leaves empty. */
  async missingRequiredForCreate(
    dto: CreateDealDto,
  ): Promise<{ id: string; label: string }[]> {
    const { requiredFields } = await this.get();
    return JOB_REQUIRABLE_FIELDS.filter((f) => {
      if (!requiredFields[f.id]) return false;
      const check = FILLED[f.id];
      // No server-side probe for this field (contact-owned) — the form owns it.
      if (!check) return false;
      return !check(dto);
    }).map((f) => ({ id: f.id, label: f.label }));
  }
}
