import { Module } from '@nestjs/common';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PortalModule } from '../portal/portal.module';
import { SignaturesModule } from '../signatures/signatures.module';
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
import { PaymentReportController } from './report/payment-report.controller';
import { PaymentReportProjector } from './report/payment-report.projector';
import { PaymentReportRepository } from './report/payment-report.repository';
import { PaymentReportService } from './report/payment-report.service';
import { StripeEventsHandler } from './stripe/stripe-events.handler';
import { StripeWebhookController } from './stripe/stripe-webhook.controller';
import {
  EstimateTerminalController,
  InvoiceTerminalController,
  TerminalController,
  TerminalIntentsController,
} from './terminal/terminal.controller';
import { TerminalService } from './terminal/terminal.service';

/**
 * The payment ledger: staff endpoints, the client's three portal routes, the
 * Stripe webhook, the reconciliation sweep and Stripe Terminal (Tap to Pay on
 * a staff phone).
 *
 * Imported LAST in app.module so its `invoices/:id/payments` routes sit behind
 * the invoice routes, and its `public/portal/...` routes behind the portal's.
 * Estimates, companies and signatures are imported for Terminal: a deposit
 * reads its estimate, the Location the default company's address, and the
 * sign-first gate the signatures on file. None of them imports this module.
 */
@Module({
  imports: [PaymentsLedgerModule, InvoicesModule, PortalModule, EstimatesModule, BusinessProfileModule, SignaturesModule],
  controllers: [
    // Static `/payments/internal/...` paths first, ahead of any `/payments/:paymentId/...`.
    PaymentsInternalController,
    InvoicePaymentsController,
    DealPaymentsController,
    // Static `/payments/report` paths, before the ledger's `/payments/:paymentId/...`.
    PaymentReportController,
    PaymentsController,
    PaymentSettingsController,
    PublicPaymentsController,
    StripeWebhookController,
    // Tap to Pay: `/terminal/...`, `/invoices/:id/terminal-intent`,
    // `/estimates/:id/terminal-intent`, `/terminal-intents/:paymentId/...`.
    TerminalController,
    InvoiceTerminalController,
    EstimateTerminalController,
    TerminalIntentsController,
  ],
  providers: [
    PaymentsService,
    PortalPaymentsService,
    TerminalService,
    StripeEventsHandler,
    PaymentReconcileScheduler,
    PaymentReportRepository,
    PaymentReportProjector,
    PaymentReportService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
