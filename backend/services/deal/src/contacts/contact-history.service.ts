import { BadRequestException, Injectable } from '@nestjs/common';
import type { ContactHistoryEntry } from '@bitcrm/types';
import { TimelineRepository } from '../timeline/timeline.repository';
import { DealsRepository } from '../deals/deals.repository';
import { historyKey, mergeClientEvents } from './contact-history.merge';

export interface ContactHistoryPage {
  items: ContactHistoryEntry[];
  nextCursor?: string;
}

/**
 * Where a page of the history continues: `t` is DynamoDB's position in GSI10,
 * `b` the key of the last row shown, so the merge of the client-level rows
 * never repeats one (`contact-history.merge.ts`).
 */
interface HistoryCursor {
  t?: string;
  b?: string;
}

/**
 * The client card's History: every event of the client's jobs (GSI10
 * ContactActivityIndex, newest first, paged) with the import's client-level
 * events (`CLIENT#<id>` / `ACT#…`: created / deleted) folded in by time, and
 * each job event labelled with its job number — one BatchGet of the page's
 * distinct jobs — so the card can say "Job: NU8GUR".
 */
@Injectable()
export class ContactHistoryService {
  constructor(
    private readonly timeline: TimelineRepository,
    private readonly deals: DealsRepository,
  ) {}

  async list(contactId: string, limit: number, cursor?: string): Promise<ContactHistoryPage> {
    const state = this.decode(cursor);
    const [page, clientRows] = await Promise.all([
      this.timeline.findByContact(contactId, limit, state.t),
      this.timeline.findClientActivity(contactId),
    ]);
    const merged = mergeClientEvents(page.items, clientRows, {
      after: state.b,
      hasMore: Boolean(page.nextCursor),
    });

    const dealIds = [...new Set(merged.map((e) => e.dealId).filter((id): id is string => Boolean(id)))];
    const numbers = new Map<string, string>();
    if (dealIds.length) {
      for (const deal of await this.deals.findByIds(dealIds)) {
        if (deal.dealNumber) numbers.set(deal.id, deal.dealNumber);
      }
    }

    const items: ContactHistoryEntry[] = merged.map((entry) => {
      const { dealId, ...rest } = entry;
      const dealNumber = dealId ? numbers.get(dealId) : undefined;
      return { ...rest, ...(dealId && { dealId }), ...(dealNumber && { dealNumber }) };
    });

    const nextCursor = page.nextCursor
      ? this.encode({ t: page.nextCursor, b: merged.length ? historyKey(merged[merged.length - 1]) : state.b })
      : undefined;
    return { items, nextCursor };
  }

  private encode(cursor: HistoryCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decode(cursor?: string): HistoryCursor {
    if (!cursor) return {};
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as unknown;
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      const { t, b } = parsed as Record<string, unknown>;
      if ((t !== undefined && typeof t !== 'string') || (b !== undefined && typeof b !== 'string')) {
        throw new Error('bad fields');
      }
      return { t, b };
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }
}
