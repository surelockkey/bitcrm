import { Module } from '@nestjs/common';
import { ClientTagsController } from './client-tags.controller';
import { ClientTagsService } from './client-tags.service';
import { ClientTagsRepository } from './client-tags.repository';

@Module({
  controllers: [ClientTagsController],
  providers: [ClientTagsService, ClientTagsRepository],
  exports: [ClientTagsService],
})
export class ClientTagsModule {}
