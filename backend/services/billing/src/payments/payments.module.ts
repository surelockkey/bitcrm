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
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { PortalPaymentsService } from './portal-payments.service';
import { PublicPaymentsController } from './public-payments.controller';
import { PaymentReportController } from './report/payment-report.controller';
import { PaymentReportProjector } from './report/payment-report.projector';
import { PaymentReportRepository } from './report/payment-report.repository';
import { PaymentReportService } from './report/payment-report.service';
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
    InvoicePaymentsController,
    DealPaymentsController,
    // Static `/payments/report` paths, before the ledger's `/payments/:paymentId/...`.
    PaymentReportController,
    PaymentsController,
    PaymentSettingsController,
    PublicPaymentsController,
    StripeWebhookController,
  ],
  providers: [
    PaymentsService,
    PortalPaymentsService,
    StripeEventsHandler,
    PaymentReconcileScheduler,
    PaymentReportRepository,
    PaymentReportProjector,
    PaymentReportService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
