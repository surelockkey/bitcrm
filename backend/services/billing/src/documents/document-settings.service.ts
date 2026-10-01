import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_NOTES_MAX_LENGTH,
  PORTAL_LINK_SHORT_CODE,
  type DocumentSettings,
} from '@bitcrm/types';
import { DocumentSettingsRepository } from './document-settings.repository';

/** A PATCH-shaped update: `undefined` leaves a field alone, `null` clears the default deposit. */
export interface DocumentSettingsPatch {
  estimateNotes?: string;
  invoiceNotes?: string;
  depositPercentage?: number | null;
  depositAmount?: number | null;
  requestInvoiceSignature?: boolean;
  showUnselectedProposalOptions?: boolean;
  invoiceEmailSubject?: string;
  invoiceMessage?: string;
  estimateEmailSubject?: string;
  estimateMessage?: string;
  proposalEmailSubject?: string;
  proposalMessage?: string;
}

const SUBJECT_KEYS = ['invoiceEmailSubject', 'estimateEmailSubject', 'proposalEmailSubject'] as const;
const MESSAGE_KEYS = ['invoiceMessage', 'estimateMessage', 'proposalMessage'] as const;
const SUBJECT_MAX_LENGTH = 250;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Account-wide document defaults (Workiz: Settings → Documents; the estimate
 * deposit's "Set for future estimates"; the Send panel's "Request signature").
 * Reads fall back to `DEFAULT_DOCUMENT_SETTINGS` — "Thank you for considering
 * our services!" on every new estimate and invoice — until a row is saved.
 */
@Injectable()
export class DocumentSettingsService {
  constructor(private readonly repo: DocumentSettingsRepository) {}

  async get(): Promise<DocumentSettings> {
    return { ...DEFAULT_DOCUMENT_SETTINGS, ...((await this.repo.getSettings()) ?? {}) };
  }

  async update(patch: DocumentSettingsPatch, userId: string): Promise<DocumentSettings> {
    const next: DocumentSettings = await this.get();

    for (const key of ['estimateNotes', 'invoiceNotes'] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw new BadRequestException(`${key} must be text`);
      if (value.length > DOCUMENT_NOTES_MAX_LENGTH) {
        throw new BadRequestException(`${key} cannot be longer than ${DOCUMENT_NOTES_MAX_LENGTH} characters`);
      }
      next[key] = value.trim();
    }

    if (patch.depositPercentage !== undefined && patch.depositAmount !== undefined && patch.depositPercentage !== null && patch.depositAmount !== null) {
      throw new BadRequestException('A default deposit is either a percent of the total or a fixed amount, not both');
    }
    if (patch.depositPercentage !== undefined) {
      delete next.depositPercentage;
      delete next.depositAmount;
      if (patch.depositPercentage !== null) {
        if (!isNumber(patch.depositPercentage) || patch.depositPercentage < 0 || patch.depositPercentage > 100) {
          throw new BadRequestException('A deposit percent must be between 0 and 100');
        }
        if (patch.depositPercentage > 0) next.depositPercentage = round2(patch.depositPercentage);
      }
    }
    if (patch.depositAmount !== undefined) {
      delete next.depositPercentage;
      delete next.depositAmount;
      if (patch.depositAmount !== null) {
        if (!isNumber(patch.depositAmount) || patch.depositAmount < 0) {
          throw new BadRequestException('A deposit amount cannot be negative');
        }
        if (patch.depositAmount > 0) next.depositAmount = round2(patch.depositAmount);
      }
    }

    for (const key of SUBJECT_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${key} cannot be empty`);
      if (value.length > SUBJECT_MAX_LENGTH) {
        throw new BadRequestException(`${key} cannot be longer than ${SUBJECT_MAX_LENGTH} characters`);
      }
      next[key] = value.trim();
    }
    for (const key of MESSAGE_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${key} cannot be empty`);
      if (value.length > DOCUMENT_NOTES_MAX_LENGTH) {
        throw new BadRequestException(`${key} cannot be longer than ${DOCUMENT_NOTES_MAX_LENGTH} characters`);
      }
      if (!value.includes(PORTAL_LINK_SHORT_CODE)) {
        throw new BadRequestException(`${key} must keep ${PORTAL_LINK_SHORT_CODE} — the client has nothing to open without it`);
      }
      next[key] = value.trim();
    }

    if (patch.requestInvoiceSignature !== undefined) next.requestInvoiceSignature = !!patch.requestInvoiceSignature;
    if (patch.showUnselectedProposalOptions !== undefined) {
      next.showUnselectedProposalOptions = !!patch.showUnselectedProposalOptions;
    }

    next.updatedBy = userId;
    next.updatedAt = new Date().toISOString();
    return this.repo.putSettings(next);
  }
}
