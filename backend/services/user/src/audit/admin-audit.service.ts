import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { getTraceId } from '@bitcrm/shared';
import type {
  AdminAuditAction,
  AdminAuditChange,
  AdminAuditEntry,
  AdminAuditTargetType,
  JwtUser,
} from '@bitcrm/types';
import { AdminAuditRepository } from './admin-audit.repository';
import { adminAuditActorPk, adminAuditMonthPk, adminAuditTargetPk } from './admin-audit.constants';

/** The first month there is a trail for: the month walk stops here. */
export const ADMIN_AUDIT_FIRST_MONTH = '2026-10';

export interface AdminAuditTarget {
  type: AdminAuditTargetType;
  id: string;
  /** The person's name and email, or the role's name — as it is now. */
  label?: string;
}

export interface AdminAuditQuery {
  limit: number;
  targetType?: AdminAuditTargetType;
  targetId?: string;
  actorId?: string;
  cursor?: string;
  /** For tests: the month the walk starts from. */
  now?: Date;
}

interface MonthCursor {
  m: string;
  k?: Record<string, unknown>;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function encodeCursor(c: MonthCursor | Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Who did what to a person or a role. Every sensitive admin action in
 * user-service calls `record` AFTER it succeeded; the entry is stored (see
 * `AdminAuditRepository`) and written as one log line starting `AUDIT`, so
 * CloudWatch/Loki can find it with a plain `"AUDIT"` filter even if the row
 * write failed. Recording never fails the action — it already happened.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger('AdminAudit');

  constructor(private readonly repository: AdminAuditRepository) {}

  async record(
    actor: JwtUser,
    action: AdminAuditAction,
    target: AdminAuditTarget,
    changes?: Record<string, AdminAuditChange>,
  ): Promise<void> {
    const traceId = getTraceId();
    const entry: AdminAuditEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      action,
      actorId: actor.id,
      ...(actor.email && { actorEmail: actor.email }),
      ...(actor.roleId && { actorRoleId: actor.roleId }),
      targetType: target.type,
      targetId: target.id,
      ...(target.label && { targetLabel: target.label }),
      ...(changes && { changes }),
      ...(traceId && { traceId }),
    };
    // Ids only in the log line; the row carries the names.
    this.logger.log(
      `AUDIT ${action} ${target.type}:${target.id} by ${actor.id} (${actor.roleId ?? '-'})` +
        (changes ? ` changes=${Object.keys(changes).join(',')}` : ''),
    );
    try {
      await this.repository.record(entry);
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED (${(error as Error).name}: ${(error as Error).message}) ${JSON.stringify(entry)}`,
      );
    }
  }

  /**
   * Newest first: one subject's history, one actor's, or — with neither — the
   * whole trail, walking the month partitions back to the first one.
   */
  async list(query: AdminAuditQuery): Promise<{ items: AdminAuditEntry[]; nextCursor?: string }> {
    const cursor = decodeCursor(query.cursor);
    const pk =
      query.targetType && query.targetId
        ? adminAuditTargetPk(query.targetType, query.targetId)
        : query.actorId
          ? adminAuditActorPk(query.actorId)
          : undefined;

    if (pk) {
      const page = await this.repository.page(pk, query.limit, cursor);
      return { items: page.items, ...(page.lastKey && { nextCursor: encodeCursor(page.lastKey) }) };
    }

    const current = (query.now ?? new Date()).toISOString().slice(0, 7);
    let month = typeof cursor?.m === 'string' && /^\d{4}-\d\d$/.test(cursor.m) ? cursor.m : current;
    let startKey = cursor?.k as Record<string, unknown> | undefined;
    const items: AdminAuditEntry[] = [];
    while (month >= ADMIN_AUDIT_FIRST_MONTH) {
      const page = await this.repository.page(adminAuditMonthPk(month), query.limit - items.length, startKey);
      items.push(...page.items);
      if (items.length >= query.limit) {
        if (page.lastKey) return { items, nextCursor: encodeCursor({ m: month, k: page.lastKey }) };
        const older = previousMonth(month);
        return { items, ...(older >= ADMIN_AUDIT_FIRST_MONTH && { nextCursor: encodeCursor({ m: older }) }) };
      }
      if (page.lastKey) {
        startKey = page.lastKey;
        continue;
      }
      month = previousMonth(month);
      startKey = undefined;
    }
    return { items };
  }
}
