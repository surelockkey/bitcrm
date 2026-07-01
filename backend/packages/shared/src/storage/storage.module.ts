import { Global, Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { KmsService } from './kms.service';

@Global()
@Module({
  providers: [S3Service, KmsService],
  exports: [S3Service, KmsService],
})
export class StorageModule {}
