import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DEFAULT_PAYMENT_SETTINGS,
  MAX_SURCHARGE_PERCENT,
  ONLINE_PAYMENT_METHODS,
  type OnlinePaymentMethod,
  type PaymentSettings,
} from '@bitcrm/types';
import { PaymentsRepository } from './payments.repository';
import { round2 } from './payment-rules';

/** What `PUT /payment-settings` may change — the Terminal Location is the Terminal routes' own. */
export type PaymentSettingsPatch = Partial<Omit<PaymentSettings, 'updatedBy' | 'updatedAt' | 'terminalLocationId'>>;

/**
 * The account-wide payment configuration (`SETTINGS` / `PAYMENTS`). A
 * singleton with no row until someone saves one — reads fall back to
 * `DEFAULT_PAYMENT_SETTINGS`, which is why the service works on a fresh
 * install. Stripe keys are NEVER stored here; they are environment config.
 */
@Injectable()
export class PaymentSettingsService {
  constructor(private readonly repo: PaymentsRepository) {}

  get(): Promise<PaymentSettings> {
    return this.repo.getSettings();
  }

  async update(patch: PaymentSettingsPatch, userId: string): Promise<PaymentSettings> {
    const current = await this.repo.getSettings();
    const next: PaymentSettings = { ...DEFAULT_PAYMENT_SETTINGS, ...current, ...prune(patch) };

    if (!isNumber(next.surchargePercent) || next.surchargePercent < 0 || next.surchargePercent > MAX_SURCHARGE_PERCENT) {
      throw new BadRequestException(
        `A card surcharge must be between 0 and ${MAX_SURCHARGE_PERCENT}% (US card-network rules)`,
      );
    }
    if (!isNumber(next.bankMinimum) || next.bankMinimum < 0) {
      throw new BadRequestException('The bank payment minimum cannot be negative');
    }
    if (!Array.isArray(next.tipPresets) || next.tipPresets.some((t) => !isNumber(t) || t < 0 || t > 100)) {
      throw new BadRequestException('Tip presets must be percentages between 0 and 100');
    }
    next.surchargePercent = round2(next.surchargePercent);
    next.bankMinimum = round2(next.bankMinimum);
    next.updatedBy = userId;
    next.updatedAt = new Date().toISOString();
    return this.repo.putSettings(next);
  }

  /**
   * Remembers the account's Stripe Terminal Location (created from the
   * default company's address). Kept on the settings row, so a fresh
   * environment needs no new env var — only `POST /terminal/location` once.
   */
  async setTerminalLocation(locationId: string, userId: string): Promise<PaymentSettings> {
    const current = await this.repo.getSettings();
    return this.repo.putSettings({
      ...DEFAULT_PAYMENT_SETTINGS,
      ...current,
      terminalLocationId: locationId,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Which methods a given invoice may actually be paid with: the account
   * switches, narrowed by the document's own "Let client pay with" choice,
   * and nothing at all without a Stripe secret key.
   */
  methodsFor(
    settings: PaymentSettings,
    allowedMethods: OnlinePaymentMethod[] | undefined,
    stripeAvailable: boolean,
  ): OnlinePaymentMethod[] {
    if (!stripeAvailable || !settings.onlinePaymentsEnabled) return [];
    const enabled = ONLINE_PAYMENT_METHODS.filter((m) =>
      m === 'card' ? settings.cardEnabled : settings.bankEnabled,
    );
    if (!allowedMethods) return [...enabled];
    return enabled.filter((m) => allowedMethods.includes(m));
  }
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `undefined` in a PATCH means "leave it alone", not "clear it". */
function prune(patch: PaymentSettingsPatch): PaymentSettingsPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[k] = v;
  return out as PaymentSettingsPatch;
}
