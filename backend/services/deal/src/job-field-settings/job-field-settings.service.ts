import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CLIENT_OWNED_JOB_FIELD_IDS,
  DEFAULT_JOB_FIELD_SETTINGS,
  JOB_REQUIRABLE_FIELDS,
  type JobFieldSettings,
  type JwtUser,
} from '@bitcrm/types';
import { JobFieldSettingsRepository } from './job-field-settings.repository';
import { type CreateDealDto } from '../deals/dto/create-deal.dto';

const KNOWN_IDS = new Set<string>(JOB_REQUIRABLE_FIELDS.map((f) => f.id));
const CLIENT_OWNED = new Set<string>(CLIENT_OWNED_JOB_FIELD_IDS);

/**
 * What the gate knows about the job's client — the contact record as crm
 * holds it (names, numbers, emails, addresses, the company it is filed
 * under). Read only when a client-owned row is switched on.
 */
export interface ClientFacts {
  firstName?: string;
  lastName?: string;
  companyId?: string;
  /** A free-text company name, for a caller that has one and no record. */
  companyName?: string;
  phones?: string[];
  emails?: string[];
  addresses?: unknown[];
}

/** How a create body answers each job-owned row. */
const FILLED: Partial<Record<string, (dto: CreateDealDto) => boolean>> = {
  address: (dto) => Boolean(dto.address?.street?.trim()),
  serviceArea: (dto) => Boolean(dto.serviceArea?.trim()),
  jobType: (dto) => Boolean(dto.jobTypeId),
  source: (dto) => Boolean(dto.sourceId),
  externalCompany: (dto) => Boolean(dto.externalCompanyId),
  // Workiz's "External Company or Ad Group Required?": either one will do.
  externalCompanyOrSource: (dto) => Boolean(dto.externalCompanyId || dto.sourceId),
  scheduled: (dto) => Boolean(dto.scheduledDate),
  description: (dto) => Boolean(dto.notes?.trim()),
  poNumber: (dto) => Boolean(dto.poNumber?.trim()),
  tags: (dto) => Boolean(dto.tagIds?.length),
};

/**
 * How the client answers each client-owned row. The job's own address counts
 * as the client's: a client made on the New Job form gets the typed service
 * location as their address, and a picked one is offered it.
 */
const CLIENT_FILLED: Partial<Record<string, (client: ClientFacts, dto: CreateDealDto) => boolean>> = {
  firstName: (c) => Boolean(c.firstName?.trim()),
  lastName: (c) => Boolean(c.lastName?.trim()),
  companyName: (c, dto) => Boolean(dto.companyId || c.companyId || c.companyName?.trim()),
  phone: (c) => Boolean(c.phones?.[0]?.trim()),
  secondaryPhone: (c) => Boolean(c.phones?.[1]?.trim()),
  email: (c) => Boolean(c.emails?.[0]?.trim()),
  clientAddress: (c, dto) => Boolean(c.addresses?.length) || Boolean(dto.address?.street?.trim()),
};

/**
 * Admin-configured "which job fields are required" — Workiz's Field
 * Validation (Settings → Field Validation), which "applies for job creation
 * only": `POST /deals` is gated, edits are not.
 */
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

  /**
   * Which admin-required rows this create body leaves empty, in the page's
   * order. The client-owned rows (names, numbers, email, company, the
   * client's address) are judged against the client `loadClient` reads —
   * only when one of them is on, so a create pays for the read only then.
   * Without a loader, or when the client cannot be read, those rows are left
   * to the form: the API never refuses a job for a crm that is down.
   */
  async missingRequiredForCreate(
    dto: CreateDealDto,
    loadClient?: () => Promise<ClientFacts | null | undefined>,
  ): Promise<{ id: string; label: string }[]> {
    const { requiredFields } = await this.get();
    const required = JOB_REQUIRABLE_FIELDS.filter((f) => requiredFields[f.id]);

    let client: ClientFacts | null | undefined;
    if (loadClient && required.some((f) => CLIENT_OWNED.has(f.id))) {
      try {
        client = await loadClient();
      } catch (error) {
        this.logger.warn(`Client of the new job could not be read for field validation: ${(error as Error).message}`);
        client = undefined;
      }
    }

    return required
      .filter((f) => {
        if (CLIENT_OWNED.has(f.id)) {
          // Not readable here — the form owns it.
          if (!client) return false;
          const check = CLIENT_FILLED[f.id];
          return check ? !check(client, dto) : false;
        }
        const check = FILLED[f.id];
        return check ? !check(dto) : false;
      })
      .map((f) => ({ id: f.id, label: f.label }));
  }
}
