import { Injectable, Logger, Optional } from '@nestjs/common';
import { CallsService } from './calls.service';
import { type CallRecord, type ListCallsFilter } from './calls.repository';
import { type EnrichedCall } from './party-resolver';
import { maskCalls } from './call-masking';
import { callCsvHeader, callCsvRow } from './call-export';
import { CallTagsService } from '../call-tags/call-tags.service';
import { DealNumbersClient, JobSourceNamesClient } from '../common/deal-labels.client';
import { DealTotalsClient } from '../common/deal-totals.client';

/** Rows the walk asks for at a time — the list's own ceiling. */
const PAGE = 100;
/** The most rows one file carries. The page's date box keeps a real export far below it. */
export const MAX_EXPORT_ROWS = 100_000;

export interface CallsExportSink {
  write(chunk: string): Promise<void>;
}

export interface CallsExportOptions {
  /** `financials.view` — the Revenue column. */
  money: boolean;
  /** `contacts.view_numbers` — the digits in From / To. */
  maySeeNumbers: boolean;
  /** The viewer's own bearer token: job numbers are read as them. */
  authorization?: string;
  /** Names a page of calls exactly as the list does (the controller's `withNames`). */
  name: (records: CallRecord[]) => Promise<EnrichedCall[]>;
  maxRows?: number;
}

/**
 * Workiz's "Export" (`GET /calls/export.csv`): the list's walk, page after
 * page, each page named, masked and written as it arrives — the file is never
 * held in memory. A lookup that cannot answer (a job's number, a source's or
 * a tag's name, a total) costs its cell, never the file.
 */
@Injectable()
export class CallsExportService {
  private readonly logger = new Logger(CallsExportService.name);

  constructor(
    private readonly calls: CallsService,
    @Optional() private readonly callTags?: CallTagsService,
    @Optional() private readonly dealNumbers?: DealNumbersClient,
    @Optional() private readonly jobSources?: JobSourceNamesClient,
    @Optional() private readonly dealTotals?: DealTotalsClient,
  ) {}

  async stream(
    filter: ListCallsFilter,
    opts: CallsExportOptions,
    sink: CallsExportSink,
  ): Promise<{ rows: number; truncated: boolean }> {
    const maxRows = opts.maxRows ?? MAX_EXPORT_ROWS;
    const [tags, sources] = await Promise.all([
      this.callTags?.byId().catch((e: Error) => this.skip('call tags', e)),
      this.jobSources?.names().catch((e: Error) => this.skip('job sources', e)),
    ]);
    const numbers = new Map<string, string>();
    const totals = new Map<string, number>();
    const asked = new Set<string>();

    await sink.write(`${callCsvHeader(opts.money)}\n`);

    let rows = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.calls.list(filter, cursor, PAGE);
      const room = maxRows - rows;
      const items = page.items.slice(0, room);

      if (items.length) {
        const fresh = [...new Set(items.map((c) => c.dealId).filter((id): id is string => !!id && !asked.has(id)))];
        fresh.forEach((id) => asked.add(id));
        if (fresh.length) {
          const [n, t] = await Promise.all([
            this.dealNumbers?.numbers(fresh, opts.authorization).catch((e: Error) => this.skip('job numbers', e)),
            opts.money ? this.dealTotals?.totals(fresh).catch((e: Error) => this.skip('job totals', e)) : undefined,
          ]);
          n?.forEach((v, k) => numbers.set(k, v));
          t?.forEach((v, k) => totals.set(k, v));
        }

        const named = maskCalls(await opts.name(items), opts.maySeeNumbers);
        const ctx = {
          money: opts.money,
          sourceName: (id: string) => sources?.get(id),
          tagName: (id: string) => tags?.get(id)?.name,
          jobNumber: (id: string) => numbers.get(id),
          jobTotal: (id: string) => totals.get(id),
        };
        await sink.write(named.map((call) => `${callCsvRow(call, ctx)}\n`).join(''));
        rows += items.length;
      }

      if (rows >= maxRows && (page.nextCursor || page.items.length > items.length)) {
        this.logger.warn(`Calls export stopped at ${maxRows} rows`);
        return { rows, truncated: true };
      }
      if (!page.nextCursor) return { rows, truncated: false };
      cursor = page.nextCursor;
    }
  }

  private skip(what: string, err: Error): undefined {
    this.logger.warn(`Calls export: ${what} unavailable — ${err.message}`);
    return undefined;
  }
}
