import { Module } from '@nestjs/common';
import { ExternalCompaniesController } from './external-companies.controller';
import { ExternalCompaniesService } from './external-companies.service';
import { ExternalCompaniesRepository } from './external-companies.repository';

@Module({
  controllers: [ExternalCompaniesController],
  providers: [ExternalCompaniesService, ExternalCompaniesRepository],
  exports: [ExternalCompaniesService],
})
export class ExternalCompaniesModule {}
