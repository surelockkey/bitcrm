import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { SignaturesRepository } from './signatures.repository';
import { SignaturesService } from './signatures.service';

/** Client signatures on estimates and invoices. Storage + rules only; the routes live on the documents. */
@Module({
  imports: [AssetsModule],
  providers: [SignaturesRepository, SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
