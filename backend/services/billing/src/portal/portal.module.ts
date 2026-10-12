import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { AnyPermissionGuard } from '../common/guards/any-permission.guard';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsLedgerModule } from '../payments/payments-ledger.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { ClientConfirmPageService } from './client-confirm-page.service';
import { PortalLinksController } from './portal-links.controller';
import { PortalRateLimiter } from './portal-rate-limiter';
import { PortalRepository } from './portal.repository';
import { PortalService } from './portal.service';
import { LegacyPortalRedirectController, PublicPortalController } from './public-portal.controller';
import { PublicClientConfirmController } from './public-client-confirm.controller';

@Module({
  imports: [AssetsModule, BusinessProfileModule, InvoicesModule, EstimatesModule, PaymentsLedgerModule, ProposalsModule],
  // PublicClientConfirmController: the client's {{confirm_link}} page (B12), `public/confirm/:token`.
  controllers: [PublicPortalController, LegacyPortalRedirectController, PortalLinksController, PublicClientConfirmController],
  providers: [PortalRepository, PortalService, PortalRateLimiter, AnyPermissionGuard, ClientConfirmPageService],
  // PaymentsModule reuses the token gate (`sentInvoiceFor`) and the limiter.
  exports: [PortalService, PortalRateLimiter],
})
export class PortalModule {}
