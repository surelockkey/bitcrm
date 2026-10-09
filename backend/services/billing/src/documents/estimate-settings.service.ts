import { BadRequestException, Injectable } from '@nestjs/common';
import { DEFAULT_ESTIMATE_SETTINGS, type EstimateSettings } from '@bitcrm/types';
import { EstimateSettingsRepository } from './estimate-settings.repository';

/** A PUT-shaped update: a switch left out is left alone. */
export interface EstimateSettingsPatch {
  attachPdf?: boolean;
  autoDeclineSameJob?: boolean;
}

const SWITCHES = ['attachPdf', 'autoDeclineSameJob'] as const;

/**
 * Settings → Estimates (Workiz `/root/estimatesSettings`), the two switches we
 * act on: "Attach PDF files" (the Send panel's email carries the rendered
 * PDF — `DocumentEmailAttachmentsService`) and "Auto-decline estimates related
 * to the same job" (`EstimatesService` on approval). Reads fall back to the
 * account's own Workiz values, both ON, until a row is saved.
 */
@Injectable()
export class EstimateSettingsService {
  constructor(private readonly repo: EstimateSettingsRepository) {}

  async get(): Promise<EstimateSettings> {
    return { ...DEFAULT_ESTIMATE_SETTINGS, ...((await this.repo.getSettings()) ?? {}) };
  }

  async update(patch: EstimateSettingsPatch, userId: string): Promise<EstimateSettings> {
    const sent = SWITCHES.filter((key) => patch[key] !== undefined);
    if (sent.length === 0) throw new BadRequestException('Nothing to set: send attachPdf and/or autoDeclineSameJob');
    const next = await this.get();
    for (const key of sent) {
      if (typeof patch[key] !== 'boolean') throw new BadRequestException(`${key} must be true or false`);
      next[key] = patch[key] as boolean;
    }
    next.updatedBy = userId;
    next.updatedAt = new Date().toISOString();
    return this.repo.putSettings(next);
  }
}
