import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  DocumentTemplate,
  DocumentTemplateContent,
  DocumentTemplateKind,
  DocumentTemplateSummary,
  JwtUser,
} from '@bitcrm/types';
import {
  DEFAULT_ESTIMATE_TEMPLATE_ID,
  DEFAULT_INVOICE_TEMPLATE_ID,
} from '../common/constants/dynamo.constants';
import { DOCUMENT_PRESETS, createTemplateContent, validateTemplateContent } from '../documents/renderer';
import { selectTemplate, type TemplateSelectionInput } from './template-selection';
import { TemplateVersionConflictError, TemplatesRepository } from './templates.repository';

const SEEDS: Array<{ id: string; kind: DocumentTemplateKind; name: string }> = [
  { id: DEFAULT_INVOICE_TEMPLATE_ID, kind: 'invoice', name: 'Default invoice' },
  { id: DEFAULT_ESTIMATE_TEMPLATE_ID, kind: 'estimate', name: 'Default estimate' },
];

const seededIdFor = (kind: DocumentTemplateKind) =>
  kind === 'estimate' ? DEFAULT_ESTIMATE_TEMPLATE_ID : DEFAULT_INVOICE_TEMPLATE_ID;

export interface CreateTemplateInput {
  name: string;
  kind: DocumentTemplateKind;
  presetId?: string;
  fromTemplateId?: string;
}

export interface UpdateTemplateInput extends DocumentTemplateContent {
  name?: string;
  autoApply?: DocumentTemplate['autoApply'] | null;
  version: number;
}

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private seeded = false;

  constructor(private readonly repo: TemplatesRepository) {}

  /**
   * Lazily seeds the classic default invoice + estimate templates. Idempotent
   * across instances: fixed ids + a conditional put.
   */
  async ensureDefaults(): Promise<void> {
    if (this.seeded) return;
    const now = new Date().toISOString();
    for (const seed of SEEDS) {
      await this.repo.createIfAbsent({
        ...createTemplateContent(seed.kind, 'classic'),
        id: seed.id,
        name: seed.name,
        kind: seed.kind,
        isDefault: true,
        preset: 'classic',
        version: 1,
        createdBy: 'system',
        createdAt: now,
        updatedAt: now,
      });
    }
    this.seeded = true;
  }

  presets() {
    return DOCUMENT_PRESETS;
  }

  async list(): Promise<DocumentTemplateSummary[]> {
    await this.ensureDefaults();
    const all = await this.repo.list();
    return all
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          Number(b.isDefault) - Number(a.isDefault) ||
          a.name.localeCompare(b.name),
      )
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        isDefault: t.isDefault,
        preset: t.preset,
        autoApply: t.autoApply,
        version: t.version,
        updatedAt: t.updatedAt,
      }));
  }

  async get(id: string): Promise<DocumentTemplate> {
    if (id === DEFAULT_INVOICE_TEMPLATE_ID || id === DEFAULT_ESTIMATE_TEMPLATE_ID) {
      await this.ensureDefaults();
    }
    const t = await this.repo.get(id);
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  async create(input: CreateTemplateInput, user: JwtUser): Promise<DocumentTemplate> {
    let content: DocumentTemplateContent;
    let preset = input.presetId;
    let autoApply: DocumentTemplate['autoApply'];
    if (input.fromTemplateId) {
      const src = await this.get(input.fromTemplateId);
      content = pickContent(src);
      preset = src.preset;
      autoApply = undefined;
    } else {
      content = createTemplateContent(input.kind, input.presetId ?? 'classic');
      preset = input.presetId ?? 'classic';
    }
    const now = new Date().toISOString();
    const template: DocumentTemplate = {
      ...content,
      id: randomUUID(),
      name: input.name.trim(),
      kind: input.kind,
      isDefault: false,
      ...(preset && { preset }),
      ...(autoApply && { autoApply }),
      version: 1,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.createIfAbsent(template);
    return template;
  }

  async update(id: string, input: UpdateTemplateInput, user: JwtUser): Promise<DocumentTemplate> {
    const current = await this.get(id);
    if (input.version !== current.version) {
      throw new ConflictException('The template was changed by someone else — reload and try again');
    }
    const checked = validateTemplateContent(pickContent(input));
    if (!checked.ok) {
      throw new BadRequestException({ message: 'Invalid template content', errors: checked.errors });
    }
    const next: DocumentTemplate = {
      ...current,
      ...checked.value,
      name: input.name?.trim() || current.name,
      version: current.version + 1,
      updatedBy: user.id,
      updatedAt: new Date().toISOString(),
    };
    if (input.autoApply === null) delete next.autoApply;
    else if (input.autoApply !== undefined) next.autoApply = normalizeAutoApply(input.autoApply);
    try {
      await this.repo.replace(next, current.version);
    } catch (err) {
      if (err instanceof TemplateVersionConflictError) {
        throw new ConflictException('The template was changed by someone else — reload and try again');
      }
      throw err;
    }
    return next;
  }

  async duplicate(id: string, user: JwtUser): Promise<DocumentTemplate> {
    const src = await this.get(id);
    return this.create({ name: `${src.name} (copy)`, kind: src.kind, fromTemplateId: src.id }, user);
  }

  async setDefault(id: string): Promise<DocumentTemplate> {
    const target = await this.get(id);
    const others = (await this.repo.list())
      .filter((t) => t.kind === target.kind && t.isDefault && t.id !== id)
      .map((t) => t.id);
    await this.repo.setDefault(id, others, new Date().toISOString());
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const t = await this.get(id);
    if (t.isDefault) {
      throw new ConflictException('The default template cannot be deleted — make another template the default first');
    }
    await this.repo.delete(id);
  }

  /** The template a document renders with (see `selectTemplate`). */
  async resolveForDocument(input: TemplateSelectionInput): Promise<DocumentTemplate> {
    await this.ensureDefaults();
    const all = await this.repo.list();
    const chosen = selectTemplate(all, input);
    if (chosen) return chosen;
    const seeded = all.find((t) => t.id === seededIdFor(input.kind)) ?? (await this.repo.get(seededIdFor(input.kind)));
    if (seeded) return seeded;
    this.logger.warn(`no template for ${input.kind}; rendering the classic preset`);
    const now = new Date().toISOString();
    return {
      ...createTemplateContent(input.kind, 'classic'),
      id: seededIdFor(input.kind),
      name: 'Default',
      kind: input.kind,
      isDefault: true,
      version: 0,
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    };
  }
}

export function pickContent(src: DocumentTemplateContent): DocumentTemplateContent {
  return {
    page: src.page,
    header: src.header ?? [],
    body: src.body ?? [],
    footer: src.footer ?? [],
    visibility: src.visibility,
  };
}

function normalizeAutoApply(rule: NonNullable<DocumentTemplate['autoApply']>): DocumentTemplate['autoApply'] {
  const jobTypeIds = [...new Set(rule.jobTypeIds ?? [])];
  const serviceAreaIds = [...new Set(rule.serviceAreaIds ?? [])];
  const businessProfileIds = [...new Set(rule.businessProfileIds ?? [])];
  if (!jobTypeIds.length && !serviceAreaIds.length && !businessProfileIds.length) return undefined;
  return {
    ...(businessProfileIds.length && { businessProfileIds }),
    ...(jobTypeIds.length && { jobTypeIds }),
    ...(serviceAreaIds.length && { serviceAreaIds }),
  };
}
