import { Module } from '@nestjs/common';
import { TaxRatesController, TaxRatesInternalController } from './tax-rates.controller';
import { TaxRatesService } from './tax-rates.service';
import { ServiceAreasModule } from '../service-areas/service-areas.module';

/** Read-only tax rates derived from service areas (no storage of its own). */
@Module({
  imports: [ServiceAreasModule],
  controllers: [TaxRatesController, TaxRatesInternalController],
  providers: [TaxRatesService],
  exports: [TaxRatesService],
})
export class TaxRatesModule {}
