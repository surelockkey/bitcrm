import { Module } from '@nestjs/common';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentsRepository } from './payments.repository';
import { StripeService } from './stripe/stripe.service';

/**
 * The ledger's storage layer on its own, so InvoicesModule and PortalModule
 * can read payments without importing PaymentsModule (which imports THEM).
 * One direction, no module cycle.
 */
@Module({
  providers: [PaymentsRepository, PaymentSettingsService, StripeService],
  exports: [PaymentsRepository, PaymentSettingsService, StripeService],
})
export class PaymentsLedgerModule {}
