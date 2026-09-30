import { Injectable, Logger, Optional } from '@nestjs/common';
import { MetricsService } from '@bitcrm/shared';
import { type Counter } from 'prom-client';
import {
  InventoryUsageRepository,
  UsageConflictError,
  type UsageUseChange,
} from './inventory-usage.repository';
import { usageKey } from './inventory-usage.constants';
import {
  type StoredUsageRow,
  type UsageJob,
  type UsageKey,
  type UsageRekeyResult,
  type UsageUseItem,
} from './inventory-usage.types';

/** Reads-and-writes one row may take before a lost race is given up on. */
const MAX_ATTEMPTS = 3;

export interface RecordUseInput {
  dealId: string;
  /** The container the units left. */
  containerId: string;
  items: UsageUseItem[];
  /** The job as deal-service sent it; absent from an older caller. */
  job?: UsageJob;
  /** When — defaults to now. */
  at?: string;
}

export interface RecordRestoreInput {
  dealId: string;
  items: Array<{ productId: string; quantity: number }>;
  job?: UsageJob;
  at?: string;
}

/**
 * Where a row belongs for this job, and what it says about the job: the
 * scheduled date keys it (a job with none files under the day of its first
 * use, flagged); every other job field the snapshot leaves out keeps what the
 * row holds — but a new technician roster without names drops the old names
 * rather than pair them with the wrong people.
 */
export function placeRow(row: StoredUsageRow, job: UsageJob): StoredUsageRow {
  const jobDate = job.scheduledDate ?? row.firstUsedAt.slice(0, 10);
  const next: StoredUsageRow = {
    ...row,
    ...usageKey(jobDate, row.dealId, row.productId),
    jobDate,
    jobDateMissing: job.scheduledDate ? undefined : true,
    dealNumber: job.dealNumber ?? row.dealNumber,
    clientName: job.clientName ?? row.clientName,
    contactId: job.contactId ?? row.contactId,
    techIds: job.techIds ?? row.techIds,
    techNames: job.techIds ? job.techNames : (job.techNames ?? row.techNames),
  };
  if (next.jobDateMissing === undefined) delete next.jobDateMissing;
  if (next.techNames === undefined) delete next.techNames;
  return next;
}

/** Whether placing the row changes anything a reader would see. */
function samePlacement(a: StoredUsageRow, b: StoredUsageRow): boolean {
  return (
    a.PK === b.PK &&
    a.SK === b.SK &&
    Boolean(a.jobDateMissing) === Boolean(b.jobDateMissing) &&
    a.dealNumber === b.dealNumber &&
    a.clientName === b.clientName &&
    a.contactId === b.contactId &&
    JSON.stringify(a.techIds ?? []) === JSON.stringify(b.techIds ?? []) &&
    JSON.stringify(a.techNames ?? null) === JSON.stringify(b.techNames ?? null)
  );
}

/**
 * The inventory-usage projection's writer — one row per (job, product), in
 * the month of the job's date, that the "Inventory Usage" report reads.
 *
 * Maintained in the same request as the stock move it mirrors: a job use
 * (STOCK_USED) adds units, creating the row with its snapshots if the job
 * never used the item; a restore (STOCK_RESTORED) takes them off and leaves
 * the row at 0 for the report to hide. A restore of an item the projection
 * never saw used writes nothing — a negative row would hide the next use;
 * `backfill:usage-from-log` rebuilds that history instead.
 *
 * Like the inventory log, it never fails the stock move: a write that fails
 * is a warning and a `bitcrm_inventory_usage_projection_failures_total` tick.
 */
@Injectable()
export class InventoryUsageService {
  private readonly logger = new Logger(InventoryUsageService.name);
  private readonly failures?: Counter;

  constructor(
    private readonly repository: InventoryUsageRepository,
    @Optional() metrics?: MetricsService,
  ) {
    this.failures = metrics?.createCounter(
      'bitcrm_inventory_usage_projection_failures_total',
      'Inventory-usage projection writes dropped (the stock move itself went through)',
      ['op'],
    );
  }

  async recordUse(input: RecordUseInput): Promise<void> {
    const at = input.at ?? new Date().toISOString();
    for (const item of input.items) {
      await this.bestEffort('use', input.dealId, item.productId, () =>
        this.applyUse(input.dealId, input.containerId, item, input.job, at),
      );
    }
  }

  async recordRestore(input: RecordRestoreInput): Promise<void> {
    const at = input.at ?? new Date().toISOString();
    for (const item of input.items) {
      await this.bestEffort('restore', input.dealId, item.productId, () =>
        this.applyRestore(input.dealId, item.productId, item.quantity, input.job, at),
      );
    }
  }

  /**
   * The job changed — rescheduled, another client, other technicians: file
   * every row it has where the job now says, through its pointers. Idempotent:
   * rows that already say it are not written. Unlike the stock-move hooks this
   * one throws, so the internal endpoint answers the failure and deal-service
   * can warn about it.
   */
  async rekeyDeal(dealId: string, job: UsageJob): Promise<UsageRekeyResult> {
    const pointers = await this.repository.listPointers(dealId);
    const result: UsageRekeyResult = { rows: pointers.length, moved: 0, updated: 0 };

    for (const pointer of pointers) {
      let key: UsageKey | null = pointer;
      for (let attempt = 1; key; attempt++) {
        const row = await this.repository.getRow(key);
        if (!row) break;
        const next = placeRow(row, job);
        if (samePlacement(row, next)) break;
        try {
          await this.repository.replace(row, next);
          if (next.PK === row.PK && next.SK === row.SK) result.updated += 1;
          else result.moved += 1;
          break;
        } catch (error) {
          if (!(error instanceof UsageConflictError) || attempt >= MAX_ATTEMPTS) throw error;
          key = await this.repository.getPointer(dealId, pointer.productId);
        }
      }
    }
    return result;
  }

  private async applyUse(
    dealId: string,
    containerId: string,
    item: UsageUseItem,
    job: UsageJob | undefined,
    at: string,
  ): Promise<void> {
    const product = item.product ?? undefined;
    const change: UsageUseChange = {
      qty: item.quantity,
      containerId,
      at,
      productName: product?.name ?? item.productName,
      sku: product?.sku,
      number: product?.number,
      category: product?.category,
      brandId: product?.brandId,
      unitPrice: item.unitPrice ?? product?.priceClient,
      unitCost: item.unitCost ?? product?.costCompany,
    };

    await this.withRetry(async () => {
      const pointer = await this.repository.getPointer(dealId, item.productId);
      const row = pointer ? await this.repository.getRow(pointer) : null;
      if (!row) {
        await this.repository.create(this.firstUse(dealId, item.productId, change, job), pointer ?? undefined);
        return;
      }
      const key = await this.placed(row, job);
      await this.repository.addUse(key, change);
    });
  }

  private async applyRestore(
    dealId: string,
    productId: string,
    quantity: number,
    job: UsageJob | undefined,
    at: string,
  ): Promise<void> {
    await this.withRetry(async () => {
      const pointer = await this.repository.getPointer(dealId, productId);
      const row = pointer ? await this.repository.getRow(pointer) : null;
      if (!row) return;
      const key = await this.placed(row, job);
      await this.repository.addRestore(key, quantity, at);
    });
  }

  /** Move the row first if the job now files it elsewhere; answers where it lives. */
  private async placed(row: StoredUsageRow, job: UsageJob | undefined): Promise<UsageKey> {
    if (!job) return { PK: row.PK, SK: row.SK };
    const next = placeRow(row, job);
    if (!samePlacement(row, next)) await this.repository.replace(row, next);
    return { PK: next.PK, SK: next.SK };
  }

  private firstUse(
    dealId: string,
    productId: string,
    change: UsageUseChange,
    job: UsageJob | undefined,
  ): StoredUsageRow {
    const jobDate = job?.scheduledDate ?? change.at.slice(0, 10);
    const row: StoredUsageRow = {
      ...usageKey(jobDate, dealId, productId),
      dealId,
      productId,
      jobDate,
      ...(!job?.scheduledDate && { jobDateMissing: true }),
      ...(job?.dealNumber !== undefined && { dealNumber: job.dealNumber }),
      ...(job?.clientName !== undefined && { clientName: job.clientName }),
      ...(job?.contactId !== undefined && { contactId: job.contactId }),
      techIds: job?.techIds ?? [],
      ...(job?.techNames !== undefined && { techNames: job.techNames }),
      productName: change.productName,
      ...(change.sku !== undefined && { sku: change.sku }),
      ...(change.number !== undefined && { number: change.number }),
      ...(change.category !== undefined && { category: change.category }),
      ...(change.brandId !== undefined && { brandId: change.brandId }),
      qty: change.qty,
      ...(change.unitPrice !== undefined && { unitPrice: change.unitPrice }),
      ...(change.unitCost !== undefined && { unitCost: change.unitCost }),
      containerIds: [change.containerId],
      firstUsedAt: change.at,
      lastUsedAt: change.at,
      source: 'bitcrm',
    };
    return row;
  }

  /** Read, decide, write — again from the read when the write lost a race. */
  private async withRetry(attempt: () => Promise<void>): Promise<void> {
    for (let tries = 1; ; tries++) {
      try {
        await attempt();
        return;
      } catch (error) {
        if (!(error instanceof UsageConflictError) || tries >= MAX_ATTEMPTS) throw error;
      }
    }
  }

  private async bestEffort(
    op: 'use' | 'restore',
    dealId: string,
    productId: string,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.failures?.inc({ op });
      this.logger.warn(
        `Inventory-usage projection dropped (${op} ${productId} on deal ${dealId}): ${(error as Error).message}`,
      );
    }
  }
}
