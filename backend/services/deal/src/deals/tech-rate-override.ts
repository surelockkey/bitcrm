import { BadRequestException } from '@nestjs/common';
import type { Deal } from '@bitcrm/types';

export type TechRateUnit = '%' | '$';

export interface TechRateOverrideInput {
  useTechSpecialRate?: boolean;
  techSpecialRate?: number | null;
  techSpecialRateUnit?: TechRateUnit;
}

/** Whether a job update touches the Custom Tech Rate at all. */
export function touchesTechRate(dto: TechRateOverrideInput): boolean {
  return dto.useTechSpecialRate !== undefined || dto.techSpecialRate !== undefined || dto.techSpecialRateUnit !== undefined;
}

/**
 * Workiz's "Custom Tech Rate" as a job update writes it: the attributes to
 * store, or a 400 for a rate that cannot be. On needs a rate (sent, or the
 * one the job holds); a rate sent without a unit is a percentage (Workiz
 * "35"); a percentage stays within 100; off keeps the rate for next time;
 * a null rate clears it and turns the override off.
 */
export function techRateOverrideUpdate(
  dto: TechRateOverrideInput,
  existing: Pick<Deal, 'useTechSpecialRate' | 'techSpecialRate' | 'techSpecialRateUnit'>,
): Record<string, unknown> {
  if (dto.techSpecialRate === null) {
    return { useTechSpecialRate: false, techSpecialRate: null, techSpecialRateUnit: null };
  }
  const out: Record<string, unknown> = {};
  const unit: TechRateUnit = dto.techSpecialRateUnit ?? (dto.techSpecialRate !== undefined ? '%' : existing.techSpecialRateUnit ?? '%');
  const rate = dto.techSpecialRate ?? existing.techSpecialRate;
  if (dto.techSpecialRate !== undefined) {
    out.techSpecialRate = dto.techSpecialRate;
    out.techSpecialRateUnit = unit;
  } else if (dto.techSpecialRateUnit !== undefined) {
    out.techSpecialRateUnit = unit;
  }
  if (dto.useTechSpecialRate !== undefined) out.useTechSpecialRate = dto.useTechSpecialRate;
  const on = dto.useTechSpecialRate ?? existing.useTechSpecialRate ?? false;
  if (on || dto.techSpecialRate !== undefined) {
    if (rate === undefined) throw new BadRequestException('A custom tech rate needs a rate');
    if (!Number.isFinite(rate) || rate < 0) throw new BadRequestException('The custom tech rate must be 0 or more');
    if (unit === '%' && rate > 100) throw new BadRequestException('A percentage rate cannot be above 100');
  }
  return out;
}
