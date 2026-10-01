import { Injectable } from '@nestjs/common';
import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService, countRows, type CountRowsResult } from '@bitcrm/shared';
import { INVOICE_PAID_TOLERANCE, type Invoice } from '@bitcrm/types';
import {
  BILLING_GSI1_NAME,
  BILLING_TABLE,
  INVOICES_GSI1PK,
  stripKeys,
} from '../../common/constants/dynamo.constants';
import { decodeCursor, encodeCursor } from '../../common/cursor';
import { normalizeSearch, type InvoiceReportFilter } from './invoice-report.rules';

/** How many index reads one page may take before it hands back a short page and a cursor. */
const MAX_ROUNDS_PER_PAGE = 25;

/**
 * The Invoices report's walk of the whole invoice list (GSI1 `INVOICES`,
 * `<createdAt>#<id>`), for the filters UnpaidIndex cannot answer — anything
 * that may select a paid invoice. The created-date window is the key
 * condition (New York days as UTC instants, exact); Status / Sent / Search
 * are one FilterExpression, so the list and its count read the same rows.
 * "Days due" never reaches here: it is open invoices only (UnpaidIndex).
 */
@Injectable()
export class InvoiceReportRepository {
  constructor(private readonly db: DynamoDbService) {}

  buildQuery(f: InvoiceReportFilter, today: string, dir: 'asc' | 'desc' = 'desc'): QueryCommandInput {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':pk': INVOICES_GSI1PK };
    let key = 'GSI1PK = :pk';
    if (f.fromIso && f.toIso) {
      values[':from'] = f.fromIso;
      values[':to'] = f.toIso;
      // `<toIso>` sorts below `<toIso>#<id>`, so BETWEEN keeps the upper end exclusive.
      key += ' AND GSI1SK BETWEEN :from AND :to';
    } else if (f.fromIso) {
      values[':from'] = f.fromIso;
      key += ' AND GSI1SK >= :from';
    } else if (f.toIso) {
      values[':to'] = f.toIso;
      key += ' AND GSI1SK < :to';
    }

    const filters: string[] = [];
    // Workiz's rule: owing a cent or less is paid.
    const openParts = () => {
      names['#st'] = 'status';
      names['#tot'] = 'totals';
      names['#bal'] = 'balanceDue';
      values[':due'] = 'due';
      values[':ovd'] = 'overdue';
      values[':cent'] = INVOICE_PAID_TOLERANCE;
    };
    const open = () => {
      openParts();
      return '(#st IN (:due, :ovd) AND #tot.#bal > :cent)';
    };
    if (f.statuses?.length) {
      const any: string[] = [];
      for (const s of new Set(f.statuses)) {
        if (s === 'paid') {
          openParts();
          values[':paid'] = 'paid';
          any.push('(#st = :paid OR (#st IN (:due, :ovd) AND #tot.#bal <= :cent))');
        } else if (s === 'due') {
          any.push(open());
        } else if (s === 'overdue') {
          const o = open();
          names['#dd'] = 'dueDate';
          values[':today'] = today;
          any.push(`(${o} AND #dd < :today)`);
        } else if (s === 'partially_paid') {
          const o = open();
          names['#paid'] = 'amountPaid';
          values[':zero'] = 0;
          any.push(`(${o} AND #tot.#paid > :zero)`);
        }
      }
      if (any.length) filters.push(`(${any.join(' OR ')})`);
    }
    const sent = new Set(f.sent ?? []);
    if (sent.size === 1) {
      names['#sent'] = 'sentAt';
      filters.push(sent.has('sent') ? 'attribute_exists(#sent)' : 'attribute_not_exists(#sent)');
    }
    const q = normalizeSearch(f.search);
    if (q) {
      names['#num'] = 'number';
      names['#wn'] = 'workizName';
      values[':qu'] = q.toUpperCase();
      values[':q'] = q;
      filters.push('(contains(#num, :qu) OR contains(#num, :q) OR contains(#wn, :q))');
    }

    return {
      TableName: BILLING_TABLE,
      IndexName: BILLING_GSI1_NAME,
      KeyConditionExpression: key,
      ScanIndexForward: dir === 'asc',
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
      ...(filters.length && { FilterExpression: filters.join(' AND ') }),
    };
  }

  /** One page, filled through the filter; the cursor is exact (`Limit` = what is still missing). */
  async page(
    f: InvoiceReportFilter,
    today: string,
    limit: number,
    cursor?: string,
    dir: 'asc' | 'desc' = 'desc',
  ): Promise<{ items: Invoice[]; nextCursor?: string }> {
    const input = this.buildQuery(f, today, dir);
    const items: Invoice[] = [];
    let startKey = decodeCursor<Record<string, unknown>>(cursor);
    for (let round = 0; round < MAX_ROUNDS_PER_PAGE && items.length < limit; round++) {
      const res = await this.db.client.send(
        new QueryCommand({ ...input, Limit: limit - items.length, ExclusiveStartKey: startKey }),
      );
      for (const i of res.Items ?? []) items.push(stripKeys<Invoice>(i)!);
      startKey = res.LastEvaluatedKey;
      if (!startKey) break;
    }
    return { items, nextCursor: startKey ? encodeCursor(startKey) : undefined };
  }

  count(f: InvoiceReportFilter, today: string): Promise<CountRowsResult> {
    const input = this.buildQuery(f, today);
    return countRows((page) => this.db.client.send(new QueryCommand({ ...input, Select: 'COUNT', ...page })));
  }

  /** Every matching invoice, newest first, up to `max` (the export). */
  async walk(f: InvoiceReportFilter, today: string, max: number): Promise<{ items: Invoice[]; truncated: boolean }> {
    const input = this.buildQuery(f, today);
    const items: Invoice[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
      for (const i of res.Items ?? []) {
        if (items.length >= max) return { items, truncated: true };
        items.push(stripKeys<Invoice>(i)!);
      }
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return { items, truncated: false };
  }
}
