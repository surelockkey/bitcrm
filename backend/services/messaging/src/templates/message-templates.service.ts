import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { BusinessMetricsService, RedisService } from '@bitcrm/shared';
import { SMS_BODY_MAX_LENGTH, type MessageTemplate } from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { MessageTemplatesRepository } from './message-templates.repository';
import { type CreateMessageTemplateDto } from './dto/create-message-template.dto';
import { type UpdateMessageTemplateDto } from './dto/update-message-template.dto';
import { type TemplatePickerChannel } from './dto/list-message-templates-query.dto';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { htmlToText } from './html-text';
import { RedisCachedValue } from '../common/redis-cached-value';

/** Every template row, archived included, in Redis for every task; dropped by every write here. */
export const MESSAGE_TEMPLATES_CACHE_KEY = 'messaging:templates:list:v1';
/** Safety net for writes that bypass this service (an import straight into DynamoDB). */
export const MESSAGE_TEMPLATES_CACHE_TTL_SECONDS = 5 * 60;

export interface ListTemplatesOptions {
  channel?: TemplatePickerChannel;
  includeInactive?: boolean;
}

/**
 * Message templates (design §3.2, §7.1): the catalog behind the composer's
 * template picker and the Settings screen. Titles are not unique — the Workiz
 * export has two "Mike" — so the identity is the id, and the list is simply
 * alphabetical. Archive, never delete, once a template has been offered.
 */
@Injectable()
export class MessageTemplatesService {
  private readonly logger = new Logger(MessageTemplatesService.name);
  private readonly listCache: RedisCachedValue<MessageTemplate[]>;

  constructor(
    private readonly repository: MessageTemplatesRepository,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() redis?: RedisService,
  ) {
    this.listCache = new RedisCachedValue(redis, MESSAGE_TEMPLATES_CACHE_KEY, MESSAGE_TEMPLATES_CACHE_TTL_SECONDS);
  }

  async create(dto: CreateMessageTemplateDto, caller: { id: string }): Promise<MessageTemplate> {
    this.assertSmsBodyFits(dto.channel, dto.messageTemplate);
    const now = new Date().toISOString();
    const template: MessageTemplate = {
      id: randomUUID(),
      messageTemplateTitle: dto.messageTemplateTitle,
      messageTemplate: dto.messageTemplate,
      messageJson: dto.messageJson,
      messageSubjectTemplate: dto.messageSubjectTemplate,
      messageSubjectJson: dto.messageSubjectJson,
      messageFrom: dto.messageFrom,
      isDefault: dto.isDefault ?? false,
      channel: dto.channel,
      category: dto.category,
      active: dto.active ?? true,
      createdBy: caller.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(template);
    if (template.isDefault) await this.clearOtherDefaults(template);
    await this.listCache.invalidate();
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'message_template' });
    this.logger.log(`Created message template ${template.id} "${template.messageTemplateTitle}"`);
    return template;
  }

  /**
   * Alphabetical by title (case-insensitive, then id so the order is stable).
   * `channel: sms` returns `sms` + `any`, `channel: email` returns `email` + `any`.
   * Every view is cut from one cached read of the whole catalog
   * (`MESSAGE_TEMPLATES_CACHE_KEY`, 5 min, dropped by every write here).
   */
  async list(opts: ListTemplatesOptions = {}): Promise<MessageTemplate[]> {
    const templates = await this.listCache.get(() => this.repository.list({ includeInactive: true }));
    return templates
      .filter((t) => opts.includeInactive || t.active)
      .filter((t) => !opts.channel || t.channel === 'any' || t.channel === opts.channel)
      .sort(
        (a, b) =>
          a.messageTemplateTitle.localeCompare(b.messageTemplateTitle, undefined, { sensitivity: 'base' }) ||
          a.id.localeCompare(b.id),
      );
  }

  async findById(id: string): Promise<MessageTemplate> {
    const template = await this.repository.get(id);
    if (!template) throw new NotFoundException(`Message template ${id} not found`);
    return template;
  }

  async update(id: string, dto: UpdateMessageTemplateDto, caller: { id: string }): Promise<MessageTemplate> {
    const existing = await this.findById(id);
    const updated: MessageTemplate = {
      ...existing,
      messageTemplateTitle: dto.messageTemplateTitle ?? existing.messageTemplateTitle,
      messageTemplate: dto.messageTemplate ?? existing.messageTemplate,
      messageJson: dto.messageJson ?? existing.messageJson,
      messageSubjectTemplate: dto.messageSubjectTemplate ?? existing.messageSubjectTemplate,
      messageSubjectJson: dto.messageSubjectJson ?? existing.messageSubjectJson,
      messageFrom: dto.messageFrom ?? existing.messageFrom,
      isDefault: dto.isDefault ?? existing.isDefault,
      channel: dto.channel ?? existing.channel,
      category: dto.category ?? existing.category,
      active: dto.active ?? existing.active,
      updatedAt: new Date().toISOString(),
    };
    this.assertSmsBodyFits(updated.channel, updated.messageTemplate);
    await this.repository.put(updated);
    if (updated.isDefault && (!existing.isDefault || updated.channel !== existing.channel)) {
      await this.clearOtherDefaults(updated);
    }
    await this.listCache.invalidate();
    this.businessMetrics?.entityUpdated?.inc({ entity_type: 'message_template' });
    this.logger.log(`Updated message template ${id} by ${caller.id}`);
    return updated;
  }

  /** `active = false`: leaves the picker, stays resolvable for history. Idempotent. */
  async archive(id: string, caller: { id: string }): Promise<MessageTemplate> {
    const existing = await this.findById(id);
    if (existing.active) {
      try {
        await this.repository.archive(id);
      } catch (err) {
        if (isConditionalCheckFailed(err)) throw new NotFoundException(`Message template ${id} not found`);
        throw err;
      }
      await this.listCache.invalidate();
      this.logger.log(`Archived message template ${id} by ${caller.id}`);
    }
    return { ...existing, active: false };
  }

  /**
   * Hard delete — only of an already-archived template, so a slip of the
   * finger on the settings screen cannot remove one still offered in the
   * composer (an accidentally duplicated import is the intended use).
   */
  async remove(id: string, caller: { id: string }): Promise<void> {
    const existing = await this.findById(id);
    if (existing.active) {
      throw new ConflictException(`Archive message template ${id} before deleting it permanently`);
    }
    await this.repository.remove(id);
    await this.listCache.invalidate();
    this.businessMetrics?.entityDeleted?.inc({ entity_type: 'message_template' });
    this.logger.log(`Deleted message template ${id} by ${caller.id}`);
  }

  /**
   * An `sms` template is sent as plain text; the HTML limit in the DTO says
   * nothing about what fits in a message, so check the text that would go out.
   */
  private assertSmsBodyFits(channel: MessageTemplate['channel'], html: string): void {
    if (channel === 'email') return;
    const length = htmlToText(html).length;
    if (length > SMS_BODY_MAX_LENGTH) {
      throw new BadRequestException(
        `SMS template body is ${length} characters as text; the limit is ${SMS_BODY_MAX_LENGTH}`,
      );
    }
  }

  /** One default per channel (`any` counts for both). Best effort, not transactional — tens of rows. */
  private async clearOtherDefaults(template: MessageTemplate): Promise<void> {
    const all = await this.repository.list({ includeInactive: true });
    const overlaps = (other: MessageTemplate) =>
      other.channel === 'any' || template.channel === 'any' || other.channel === template.channel;
    for (const other of all) {
      if (other.id === template.id || !other.isDefault || !overlaps(other)) continue;
      await this.repository.put({ ...other, isDefault: false, updatedAt: template.updatedAt });
    }
  }
}
