import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { BusinessMetricsService, SnsPublisherService, tryNormalizePhone } from '@bitcrm/shared';
import {
  MESSAGE_EVENT_TOPIC,
  MessageEventType,
  OPT_OUT_CHANNELS,
  type OptOut,
  type OptOutChannel,
  type OptOutChangedEvent,
} from '@bitcrm/types';
import { OptOutsRepository } from './opt-outs.repository';
import { type ImportOptOutsDto, type SetOptOutDto } from './dto/opt-out.dto';

export interface ImportOptOutsResult {
  imported: number;
  skipped: number;
  invalid: Array<{ address: string; channel: string; reason: string }>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMPORT_CONCURRENCY = 25;

/**
 * Administration of BitCRM's own STOP/START ledger (design §4.7): look an
 * address up, flip it by hand, remove a row, and the one-off Workiz import.
 * The pre-send check itself (`isOptedOut`) and keyword handling belong to
 * the outbound / inbound paths, which call the repository directly.
 *
 * There is deliberately no table-wide listing: `OPTOUT#` keys are spread
 * over addresses with no catalog index (§3.4), and the design only asks for
 * lookup by address. Adding one means a GSI3 partition on the item.
 */
@Injectable()
export class OptOutsService {
  private readonly logger = new Logger(OptOutsService.name);

  constructor(
    private readonly repository: OptOutsRepository,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /** E.164 for `sms`, lowercase for `email`; 400 when the address is not one of those. */
  normalizeAddress(channel: OptOutChannel, address: string): string {
    const trimmed = address.trim();
    if (channel === 'sms') {
      const e164 = tryNormalizePhone(trimmed);
      if (!e164) throw new BadRequestException(`"${address}" is not a phone number`);
      return e164;
    }
    const lower = trimmed.toLowerCase();
    if (!EMAIL.test(lower)) throw new BadRequestException(`"${address}" is not an email address`);
    return lower;
  }

  assertChannel(channel: string): OptOutChannel {
    if (!(OPT_OUT_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException(`channel must be one of ${OPT_OUT_CHANNELS.join(', ')}`);
    }
    return channel as OptOutChannel;
  }

  /** Every channel the address could be on — a phone is checked as `sms`, an email as `email`. */
  async lookup(address: string): Promise<OptOut[]> {
    const candidates: Array<[OptOutChannel, string]> = [];
    const phone = tryNormalizePhone(address.trim());
    if (phone) candidates.push(['sms', phone]);
    const lower = address.trim().toLowerCase();
    if (EMAIL.test(lower)) candidates.push(['email', lower]);
    if (candidates.length === 0) throw new BadRequestException(`"${address}" is neither a phone number nor an email`);
    const rows = await Promise.all(candidates.map(([channel, addr]) => this.repository.get(channel, addr)));
    return rows.filter((row): row is OptOut => row !== null);
  }

  async get(channel: OptOutChannel, address: string): Promise<OptOut> {
    const row = await this.repository.get(channel, this.normalizeAddress(channel, address));
    if (!row) throw new NotFoundException(`No opt-out record for ${channel} ${address}`);
    return row;
  }

  /** Manual STOP / START by an admin — recorded with `source: manual` and who did it. */
  async set(channel: OptOutChannel, address: string, dto: SetOptOutDto, caller: { id: string }): Promise<OptOut> {
    const normalized = this.normalizeAddress(channel, address);
    const row = await this.repository.setStatus({
      channel,
      address: normalized,
      status: dto.status,
      source: 'manual',
      keyword: dto.keyword,
      by: caller.id,
    });
    this.businessMetrics?.entityUpdated?.inc({ entity_type: 'opt_out' });
    this.publish({ channel, address: normalized, status: row.status, source: 'manual' });
    return row;
  }

  /** Removes the row outright — prefer `opted_in`, which keeps the history. */
  async remove(channel: OptOutChannel, address: string, caller: { id: string }): Promise<void> {
    const normalized = this.normalizeAddress(channel, address);
    await this.repository.remove(channel, normalized);
    this.businessMetrics?.entityDeleted?.inc({ entity_type: 'opt_out' });
    this.logger.log(`Opt-out row ${channel} ${normalized} removed by ${caller.id}`);
  }

  /**
   * Bulk load. Duplicates inside the batch collapse (last wins); rows that
   * already exist are skipped unless `overwrite` — a client who sent START
   * after the export must not be re-silenced by a replay. Invalid addresses
   * are reported, not fatal.
   */
  async import(dto: ImportOptOutsDto, caller: { id: string }): Promise<ImportOptOutsResult> {
    const result: ImportOptOutsResult = { imported: 0, skipped: 0, invalid: [] };
    const now = new Date().toISOString();

    const rows = new Map<string, OptOut>();
    for (const item of dto.items) {
      let address: string;
      try {
        address = this.normalizeAddress(item.channel, item.address);
      } catch (err) {
        result.invalid.push({ address: item.address, channel: item.channel, reason: (err as Error).message });
        continue;
      }
      const status = item.status ?? 'opted_out';
      const source = item.source ?? 'workiz_import';
      const at = item.at ?? now;
      rows.set(`${item.channel}#${address}`, {
        channel: item.channel,
        address,
        status,
        keyword: item.keyword,
        source,
        updatedAt: at,
        updatedBy: caller.id,
        history: [{ status, source, keyword: item.keyword, at, by: caller.id }],
      });
    }

    const pending = [...rows.values()];
    for (let i = 0; i < pending.length; i += IMPORT_CONCURRENCY) {
      await Promise.all(
        pending.slice(i, i + IMPORT_CONCURRENCY).map(async (row) => {
          if (!dto.overwrite && (await this.repository.get(row.channel, row.address))) {
            result.skipped += 1;
            return;
          }
          await this.repository.put(row);
          result.imported += 1;
        }),
      );
    }

    this.businessMetrics?.entityCreated?.inc({ entity_type: 'opt_out' }, result.imported);
    this.logger.log(
      `Opt-out import by ${caller.id}: ${result.imported} imported, ${result.skipped} skipped, ${result.invalid.length} invalid`,
    );
    return result;
  }

  private publish(payload: OptOutChangedEvent): void {
    this.snsPublisher
      ?.publish(MESSAGE_EVENT_TOPIC, MessageEventType.OPT_OUT_CHANGED, payload as unknown as Record<string, unknown>)
      .then(() => this.businessMetrics?.eventsPublished?.inc({ event_type: MessageEventType.OPT_OUT_CHANGED }))
      .catch((error: Error) => {
        this.businessMetrics?.eventsFailed?.inc({ event_type: MessageEventType.OPT_OUT_CHANGED });
        this.logger.warn(`Failed to publish ${MessageEventType.OPT_OUT_CHANGED}: ${error.message}`);
      });
  }
}
