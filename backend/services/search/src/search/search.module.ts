import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { PermissionsResolver } from './permissions-resolver.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService, PermissionsResolver],
  exports: [SearchService],
})
export class SearchModule {}
