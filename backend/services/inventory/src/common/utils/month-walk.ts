import { BadRequestException } from '@nestjs/common';

/**
 * Month-partitioned reads, newest first — the machinery the inventory log and
 * the inventory-usage report share.
 *
 * Both keep their rows one partition per month (`INVLOG#<YYYY-MM>`,
 * `USAGE#<YYYY-MM>`), never under one constant key (the CALL#ALL lesson). A
 * page is read the way a scanPage read spans DynamoDB pages: from the newest
 * month of the window down, each month read until it ends or the page is
 * full, within one read budget shared by all of them. Where it stopped is a
 * month and a key inside it, which the caller turns into a cursor.
 */

/** One month's answer: rows, where it stopped, and what that cost. */
export interface MonthWalkPage<T> {
  items: T[];
  lastKey?: Record<string, unknown>;
  /** DynamoDB reads spent; one when absent. */
  reads?: number;
}

/** Where a walk stopped, or starts again. */
export interface MonthWalkPosition {
  month: string;
  lastKey?: Record<string, unknown>;
}

/**
 * Read one month: at most `limit` rows from `startKey`, spending at most
 * `maxReads` DynamoDB reads (a filtered read fills its page across several).
 */
export type MonthReader<T> = (
  month: string,
  limit: number,
  startKey: Record<string, unknown> | undefined,
  maxReads: number,
) => Promise<MonthWalkPage<T>>;

export interface MonthWalkOptions {
  limit: number;
  /** Reads the whole page may spend before it hands the position back. */
  maxReads: number;
  /** Resume here — the month must be one of the walk's. */
  start?: MonthWalkPosition;
}

export interface MonthWalkResult<T> {
  items: T[];
  /** Absent when the walk reached the end of its last month. */
  next?: MonthWalkPosition;
}

export function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 2, 1));
  return date.toISOString().slice(0, 7);
}

/** Every month from `to` back to `from`, both included; empty when `from` is later. */
export function monthsDescending(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = to; month >= from; month = previousMonth(month)) {
    months.push(month);
  }
  return months;
}

/**
 * How many month partitions `from`…`to` (`YYYY-MM`, both included) touches.
 * Arithmetic, so a caller's `0001-01` is a big number, never a long loop.
 */
export function monthsSpanned(from: string, to: string): number {
  const [fromYear, fromMonth] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [toYear, toMonth] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

/**
 * Fill one page across `months` (newest first). An empty month is not charged
 * to the budget: it is one cheap read the window cap already bounds, and
 * charging it would hand back empty pages with a cursor across a wide window
 * until every empty month had been stepped over.
 */
export async function walkMonths<T>(
  months: string[],
  read: MonthReader<T>,
  options: MonthWalkOptions,
): Promise<MonthWalkResult<T>> {
  const { limit, maxReads, start } = options;
  let index = start ? months.indexOf(start.month) : 0;
  if (index < 0) throw new BadRequestException('Invalid cursor');

  const items: T[] = [];
  let key = start?.lastKey;
  let reads = 0;

  for (; index < months.length; index++) {
    const month = months[index];

    while (items.length < limit) {
      if (reads >= maxReads) return { items, next: { month, ...(key && { lastKey: key }) } };
      const page = await read(month, limit - items.length, key, maxReads - reads);
      if (page.items.length > 0 || page.lastKey) reads += page.reads ?? 1;
      items.push(...page.items);
      key = page.lastKey;
      if (!key) break;
    }

    if (items.length >= limit) {
      if (key) return { items, next: { month, lastKey: key } };
      // The month ended on the page boundary: the next page starts the next month.
      const next = months[index + 1];
      return { items, ...(next && { next: { month: next } }) };
    }
    key = undefined;
  }

  return { items };
}

/** A cursor is opaque to the browser: base64url JSON of whatever the service needs back. */
export function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * The object inside a cursor this service minted — anything else is a 400
 * before a read. Each caller then checks the shape it expects.
 */
export function parseCursor(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8'));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException('Invalid cursor');
  }
  return parsed as Record<string, unknown>;
}
