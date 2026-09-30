import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { S3Service } from '@bitcrm/shared';
import {
  DEFAULT_BUSINESS_PROFILE,
  DEFAULT_BUSINESS_PROFILE_ID,
  PaymentTerms,
  type BusinessProfile,
  type BusinessProfileView,
  type PortalView,
} from '@bitcrm/types';
import { AssetsRepository } from '../assets/assets.repository';
import { assetS3Key } from '../common/constants/dynamo.constants';
import { TemplatesService } from '../templates/templates.service';
import { BusinessProfileRepository } from './business-profile.repository';
import type {
  BusinessProfileFieldsDto,
  CreateBusinessProfileDto,
  PatchBusinessProfileDto,
  UpdateBusinessProfileDto,
} from './dto/update-business-profile.dto';

/** Optional fields a `null` in a write removes. */
const CLEARABLE = [
  'legalName',
  'phone',
  'email',
  'website',
  'licenseNumber',
  'address',
  'logoAssetId',
  'defaultCustomTermDays',
] as const;

/** Fields a write may set (id / isDefault / audit stamps are the service's). */
const WRITABLE = [...CLEARABLE, 'name', 'defaultPaymentTerms', 'dueDateBasis', 'active'] as const;

type Writable = Partial<Record<(typeof WRITABLE)[number], unknown>>;

/**
 * The business's companies (Revision 2 — many business profiles; exactly one
 * is the default). Jobs pick one (`Deal.businessProfileId`); documents and
 * the portal render the job's company, falling back to the default.
 *
 * The pre-Revision-2 singleton is migrated lazily on the first read.
 */
@Injectable()
export class BusinessProfileService {
  private readonly logger = new Logger(BusinessProfileService.name);
  private migrated = false;

  constructor(
    private readonly repo: BusinessProfileRepository,
    private readonly assets: AssetsRepository,
    private readonly templates: TemplatesService,
    @Optional() private readonly s3?: S3Service,
  ) {}

  // ------------------------------------------------------------------ reads

  /** Default first, then by name. Archived companies only on request. */
  async list(opts: { includeInactive?: boolean } = {}): Promise<BusinessProfileView[]> {
    const all = sortProfiles(await this.all());
    const visible = all.filter((p) => opts.includeInactive || p.active);
    return Promise.all(visible.map((p) => this.withLogo(p)));
  }

  /** Every company, archived included, without logo URLs (internal readers). */
  async listAll(): Promise<BusinessProfile[]> {
    return sortProfiles(await this.all());
  }

  async getView(id: string): Promise<BusinessProfileView> {
    return this.withLogo(await this.findOrThrow(id));
  }

  /**
   * The company a document renders with: `id` when it exists (archived
   * included — old jobs keep their brand), else the default company, else the
   * built-in placeholder.
   */
  async get(id?: string | null): Promise<BusinessProfile> {
    const all = await this.all();
    if (id) {
      const hit = all.find((p) => p.id === id);
      if (hit) return hit;
    }
    return this.defaultOf(all);
  }

  async getDefault(): Promise<BusinessProfile> {
    return this.defaultOf(await this.all());
  }

  /** Compat `GET /business-profile`: the default company with its logo URL. */
  async getWithLogo(): Promise<BusinessProfileView> {
    return this.withLogo(await this.getDefault());
  }

  /** What the client portal shows about a company (default when absent). */
  async getPublic(id?: string | null): Promise<PortalView['business']> {
    const p = await this.get(id);
    return {
      name: p.name,
      phone: p.phone,
      email: p.email,
      website: p.website,
      address: p.address,
      logoUrl: await this.logoUrl(p),
    };
  }

  // ----------------------------------------------------------------- writes

  async create(dto: CreateBusinessProfileDto, userId: string): Promise<BusinessProfileView> {
    const all = await this.all();
    const fields = pickWritable(dto);
    const name = requireName(fields.name);
    await this.assertLogo(fields.logoAssetId as string | null | undefined);

    const now = new Date().toISOString();
    const hasDefault = all.some((p) => p.isDefault);
    const next: BusinessProfile = {
      ...DEFAULT_BUSINESS_PROFILE,
      id: `bp-${randomUUID()}`,
      isDefault: false,
      active: true,
      defaultPaymentTerms: PaymentTerms.CASH,
      dueDateBasis: 'invoice_created',
      ...(stripNulls(fields) as Partial<BusinessProfile>),
      name,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    // The first company is the default (and a default is never archived).
    if (!hasDefault) {
      next.isDefault = true;
      next.active = true;
    }
    await this.repo.create(next);
    return this.withLogo(next);
  }

  async update(id: string, dto: PatchBusinessProfileDto, userId: string): Promise<BusinessProfileView> {
    const current = await this.findOrThrow(id);
    return this.withLogo(await this.applyUpdate(current, dto, userId));
  }

  /** Compat `PUT /business-profile`: writes the default company (creating bp-default when there is none). */
  async updateDefault(dto: UpdateBusinessProfileDto, userId: string): Promise<BusinessProfileView> {
    const all = await this.all();
    const current = all.find((p) => p.isDefault);
    if (current) return this.withLogo(await this.applyUpdate(current, dto, userId));

    const fields = pickWritable(dto);
    await this.assertLogo(fields.logoAssetId as string | null | undefined);
    const now = new Date().toISOString();
    const next: BusinessProfile = {
      ...DEFAULT_BUSINESS_PROFILE,
      ...(stripNulls(fields) as Partial<BusinessProfile>),
      id: DEFAULT_BUSINESS_PROFILE_ID,
      name: requireName(fields.name),
      isDefault: true,
      active: true,
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
    };
    await this.repo.create(next);
    return this.withLogo(next);
  }

  /** Makes `id` the single default (it must be active). */
  async setDefault(id: string): Promise<BusinessProfileView> {
    const target = await this.findOrThrow(id);
    if (!target.active) {
      throw new BadRequestException(`"${target.name}" is archived and cannot be the default company`);
    }
    const others = (await this.all()).filter((p) => p.isDefault && p.id !== id).map((p) => p.id);
    const now = new Date().toISOString();
    if (!target.isDefault || others.length) await this.repo.setDefault(id, others, now);
    return this.withLogo({ ...target, isDefault: true, updatedAt: now });
  }

  /**
   * Jobs keep their snapshot name, so deleting never breaks history. Refused
   * for the default company and while a template auto-applies to it.
   */
  async remove(id: string): Promise<void> {
    const target = await this.findOrThrow(id);
    if (target.isDefault) {
      throw new ConflictException('The default company cannot be deleted — make another company the default first');
    }
    const templates = await this.templates.list();
    const users = templates.filter((t) => t.autoApply?.businessProfileIds?.includes(id));
    if (users.length) {
      throw new ConflictException(
        `"${target.name}" is used by the auto-apply rule of template(s): ${users.map((t) => t.name).join(', ')}`,
      );
    }
    await this.repo.delete(id);
  }

  // ---------------------------------------------------------------- helpers

  private async applyUpdate(
    current: BusinessProfile,
    dto: BusinessProfileFieldsDto & { name?: string | null },
    userId: string,
  ): Promise<BusinessProfile> {
    const fields = pickWritable(dto);
    if ('name' in fields) fields.name = requireName(fields.name);
    if (fields.active === false && current.isDefault) {
      throw new BadRequestException('The default company cannot be archived — make another company the default first');
    }
    if (fields.logoAssetId && fields.logoAssetId !== current.logoAssetId) {
      await this.assertLogo(fields.logoAssetId as string);
    }

    const next = {
      ...current,
      ...stripNulls(fields),
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    } as BusinessProfile & Record<string, unknown>;
    for (const key of CLEARABLE) {
      if (fields[key] === null) delete next[key];
    }
    await this.repo.put(next);
    return next;
  }

  /** A logo must be a known asset whose bytes actually reached S3. */
  private async assertLogo(assetId: string | null | undefined): Promise<void> {
    if (!assetId) return;
    if (!(await this.assets.get(assetId))) throw new NotFoundException('Logo asset not found');
    if (this.s3 && !(await this.s3.objectExists(assetS3Key(assetId)))) {
      throw new UnprocessableEntityException('Logo upload did not finish — upload the image again');
    }
  }

  private async findOrThrow(id: string): Promise<BusinessProfile> {
    await this.ensureMigrated();
    const p = await this.repo.get(id);
    if (!p) throw new NotFoundException(`Company ${id} not found`);
    return normalize(p);
  }

  private async all(): Promise<BusinessProfile[]> {
    await this.ensureMigrated();
    return (await this.repo.list()).map(normalize);
  }

  private defaultOf(all: BusinessProfile[]): BusinessProfile {
    return (
      all.find((p) => p.isDefault && p.active) ??
      all.find((p) => p.isDefault) ??
      sortProfiles(all).find((p) => p.active) ?? { ...DEFAULT_BUSINESS_PROFILE }
    );
  }

  /**
   * Lazily move the legacy `SETTINGS/BUSINESS_PROFILE` singleton into
   * `BUSINESS_PROFILE#bp-default`. Idempotent across instances (conditional
   * transaction); attempted once per process.
   */
  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return;
    const legacy = await this.repo.getLegacy();
    if (legacy) {
      const existing = await this.repo.list();
      const now = new Date().toISOString();
      const row: BusinessProfile = {
        ...DEFAULT_BUSINESS_PROFILE,
        ...(stripNulls(pickWritable(legacy as Record<string, unknown>)) as Partial<BusinessProfile>),
        ...(legacy.updatedBy && { updatedBy: legacy.updatedBy }),
        id: DEFAULT_BUSINESS_PROFILE_ID,
        name: (legacy.name ?? '').trim() || DEFAULT_BUSINESS_PROFILE.name,
        active: true,
        isDefault: !existing.some((p) => p.isDefault),
        createdBy: legacy.updatedBy ?? 'system',
        createdAt: legacy.updatedAt ?? now,
        updatedAt: legacy.updatedAt ?? now,
      };
      const done = await this.repo.migrateLegacy(row);
      this.logger.log(
        done
          ? `Migrated the legacy business profile into ${DEFAULT_BUSINESS_PROFILE_ID}`
          : 'Legacy business profile already migrated elsewhere',
      );
    }
    this.migrated = true;
  }

  private async withLogo(p: BusinessProfile): Promise<BusinessProfileView> {
    const logoUrl = await this.logoUrl(p);
    return { ...p, ...(logoUrl && { logoUrl }) };
  }

  private async logoUrl(p: BusinessProfile): Promise<string | undefined> {
    if (!p.logoAssetId || !this.s3) return undefined;
    try {
      return await this.s3.getPresignedDownloadUrl(assetS3Key(p.logoAssetId), 3600);
    } catch (err) {
      this.logger.warn(`logo url failed: ${(err as Error).message}`);
      return undefined;
    }
  }
}

function sortProfiles(list: BusinessProfile[]): BusinessProfile[] {
  return [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** Rows written before a field existed still read as a complete company. */
function normalize(p: BusinessProfile): BusinessProfile {
  return {
    ...p,
    active: p.active !== false,
    isDefault: p.isDefault === true,
    defaultPaymentTerms: p.defaultPaymentTerms ?? PaymentTerms.CASH,
    dueDateBasis: p.dueDateBasis ?? 'invoice_created',
  };
}

function pickWritable(src: object): Writable {
  const out: Writable = {};
  const record = src as Record<string, unknown>;
  for (const key of WRITABLE) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return out;
}

function stripNulls(o: Writable): Writable {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
}

function requireName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw new BadRequestException('A company needs a name');
  return name;
}
