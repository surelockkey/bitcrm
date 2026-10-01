import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { AnyPermissionGuard } from '../common/guards/any-permission.guard';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsLedgerModule } from '../payments/payments-ledger.module';
import { ProposalsModule } from '../proposals/proposals.module';
import { PortalLinksController } from './portal-links.controller';
import { PortalRateLimiter } from './portal-rate-limiter';
import { PortalRepository } from './portal.repository';
import { PortalService } from './portal.service';
import { LegacyPortalRedirectController, PublicPortalController } from './public-portal.controller';

@Module({
  imports: [AssetsModule, BusinessProfileModule, InvoicesModule, EstimatesModule, PaymentsLedgerModule, ProposalsModule],
  controllers: [PublicPortalController, LegacyPortalRedirectController, PortalLinksController],
  providers: [PortalRepository, PortalService, PortalRateLimiter, AnyPermissionGuard],
  // PaymentsModule reuses the token gate (`sentInvoiceFor`) and the limiter.
  exports: [PortalService, PortalRateLimiter],
})
export class PortalModule {}
