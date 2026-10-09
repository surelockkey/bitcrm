import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DOCUMENT_NUMBER_MAX, type NumberingSettings } from '@bitcrm/types';
import { STANDALONE_NUMBER_BASE } from '../common/document-number';
import {
  LAST_NUMBER_ATTRIBUTE,
  NumberingBehindError,
  NumberingRepository,
  type AccountCountersRow,
  type NumberingKind,
} from './numbering.repository';

/** A PUT-shaped update: a counter left out is left alone. */
export interface NumberingPatch {
  nextInvoiceNumber?: number;
  nextEstimateNumber?: number;
}

const KINDS: ReadonlyArray<{ kind: NumberingKind; field: keyof NumberingPatch; label: string }> = [
  { kind: 'invoice', field: 'nextInvoiceNumber', label: 'Next Invoice Id' },
  { kind: 'estimate', field: 'nextEstimateNumber', label: 'Next Estimate Id' },
];

/** Workiz's own words under the boxes: "numbers must be more than the last number". */
const behindMessage = (label: string, last: number) => `${label} must be more than the last number (${last})`;

/**
 * Settings → Numbering (Workiz): the next number of a CLIENT invoice and of a
 * CLIENT estimate — two counters, as Workiz keeps them (its invoice counter
 * stood at 85 426 and its estimate counter at 1 141 in the 2026-09 dump; the
 * office sets ours to the numbers after Workiz's last ones at cut-over).
 *
 * A job's documents never come here: a job invoice carries the job's number
 * and a job estimate `<job number>-<n>`, as Workiz shows them.
 *
 * Until a counter has handed out or been set a number, it continues the
 * legacy shared counter (`1000 + documentSeq`), so the numbers of the client
 * documents created before this existed are never given out again.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly repo: NumberingRepository) {}

  async get(): Promise<NumberingSettings> {
    return this.settingsOf(await this.repo.read());
  }

  /** The next number of `kind`, handed out exactly once — what a new client document is called. */
  async nextNumber(kind: NumberingKind): Promise<string> {
    const row = await this.repo.read();
    return String(await this.repo.allocate(kind, legacyLast(row)));
  }

  async update(patch: NumberingPatch, userId: string): Promise<NumberingSettings> {
    const wanted = KINDS.filter(({ field }) => patch[field] !== undefined);
    if (wanted.length === 0) throw new BadRequestException('Nothing to set: send nextInvoiceNumber and/or nextEstimateNumber');
    for (const { field, label } of wanted) {
      const n = patch[field];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > DOCUMENT_NUMBER_MAX) {
        throw new BadRequestException(`${label} must be a whole number between 1 and ${DOCUMENT_NUMBER_MAX}`);
      }
    }

    const row = await this.repo.read();
    for (const { kind, field, label } of wanted) {
      const last = lastUsed(row, kind);
      if ((patch[field] as number) <= last) throw new BadRequestException(behindMessage(label, last));
    }

    const now = new Date().toISOString();
    for (const { kind, field, label } of wanted) {
      try {
        await this.repo.setLast(kind, (patch[field] as number) - 1, userId, now);
      } catch (err) {
        if (!(err instanceof NumberingBehindError)) throw err;
        // A document took a number between the read and the write; say which.
        const last = lastUsed(await this.repo.read(), kind);
        throw new ConflictException(`${behindMessage(label, last)} — a document took a number just now`);
      }
    }
    return this.get();
  }

  private settingsOf(row: AccountCountersRow): NumberingSettings {
    return {
      nextInvoiceNumber: lastUsed(row, 'invoice') + 1,
      nextEstimateNumber: lastUsed(row, 'estimate') + 1,
      ...(row.numberingUpdatedBy && { updatedBy: row.numberingUpdatedBy }),
      ...(row.numberingUpdatedAt && { updatedAt: row.numberingUpdatedAt }),
    };
  }
}

/** The last number the legacy shared counter gave a client document (its base when it gave none). */
export function legacyLast(row: Pick<AccountCountersRow, 'documentSeq'>): number {
  return STANDALONE_NUMBER_BASE + (row.documentSeq ?? 0);
}

/** The last number handed out for `kind`: its own counter, else the legacy one. */
export function lastUsed(row: AccountCountersRow, kind: NumberingKind): number {
  const own = row[LAST_NUMBER_ATTRIBUTE[kind]];
  return typeof own === 'number' ? own : legacyLast(row);
}
