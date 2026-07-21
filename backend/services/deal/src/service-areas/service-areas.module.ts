import { Module } from '@nestjs/common';
import { ServiceAreasController } from './service-areas.controller';
import { ServiceAreasService } from './service-areas.service';
import { ServiceAreasRepository } from './service-areas.repository';
import { ServiceAreasBackfill } from './service-areas.backfill';

@Module({
  controllers: [ServiceAreasController],
  providers: [ServiceAreasService, ServiceAreasRepository, ServiceAreasBackfill],
  exports: [ServiceAreasService],
})
export class ServiceAreasModule {}
