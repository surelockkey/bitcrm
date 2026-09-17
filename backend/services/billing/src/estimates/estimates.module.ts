import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { EstimatesController } from './estimates.controller';
import { EstimatesRepository } from './estimates.repository';
import { EstimatesService } from './estimates.service';

@Module({
  imports: [DocumentsModule],
  controllers: [EstimatesController],
  providers: [EstimatesRepository, EstimatesService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
