import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { PortalModule } from '../portal/portal.module';
import { PaymentReconcileScheduler } from './payment-reconcile.scheduler';
import { PaymentsLedgerModule } from './payments-ledger.module';
import {
  DealPaymentsController,
  InvoicePaymentsController,
  PaymentSettingsController,
  PaymentsController,
  PaymentsInternalController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortalPaymentsService } from './portal-payments.service';
import { PublicPaymentsController } from './public-payments.controller';
import { StripeEventsHandler } from './stripe/stripe-events.handler';
import { StripeWebhookController } from './stripe/stripe-webhook.controller';

/**
 * The payment ledger: staff endpoints, the client's three portal routes, the
 * Stripe webhook and the reconciliation sweep.
 *
 * Imported LAST in app.module so its `invoices/:id/payments` routes sit behind
 * the invoice routes, and its `public/portal/...` routes behind the portal's.
 */
@Module({
  imports: [PaymentsLedgerModule, InvoicesModule, PortalModule],
  controllers: [
    // Static `/payments/internal/...` paths first, ahead of any `/payments/:paymentId/...`.
    PaymentsInternalController,
    InvoicePaymentsController,
    DealPaymentsController,
    PaymentsController,
    PaymentSettingsController,
    PublicPaymentsController,
    StripeWebhookController,
  ],
  providers: [PaymentsService, PortalPaymentsService, StripeEventsHandler, PaymentReconcileScheduler],
  exports: [PaymentsService],
})
export class PaymentsModule {}
