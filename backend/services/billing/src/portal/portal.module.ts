import { Module } from '@nestjs/common';
import { BusinessProfileModule } from '../business-profile/business-profile.module';
import { AnyPermissionGuard } from '../common/guards/any-permission.guard';
import { EstimatesModule } from '../estimates/estimates.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PortalLinksController } from './portal-links.controller';
import { PortalRateLimiter } from './portal-rate-limiter';
import { PortalRepository } from './portal.repository';
import { PortalService } from './portal.service';
import { LegacyPortalRedirectController, PublicPortalController } from './public-portal.controller';

@Module({
  imports: [BusinessProfileModule, InvoicesModule, EstimatesModule],
  controllers: [PublicPortalController, LegacyPortalRedirectController, PortalLinksController],
  providers: [PortalRepository, PortalService, PortalRateLimiter, AnyPermissionGuard],
})
export class PortalModule {}
