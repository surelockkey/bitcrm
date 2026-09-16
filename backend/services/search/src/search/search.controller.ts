import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@bitcrm/shared';
import { JwtUser, SearchResponse } from '@bitcrm/types';
import { SearchService } from './search.service';
import { SearchQueryDto, normalizeSearchQuery } from './dto/search-query.dto';

@ApiTags('search')
@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary:
      'Global search across all entities (deals, contacts, companies, users, technicians, inventory, ' +
      'conversations). Results are filtered to what the caller is permitted to view; ' +
      '`type=conversation` (csv with the others) narrows to inbox threads, which link to /messages/:id.',
  })
  async search(
    @CurrentUser() user: JwtUser,
    @Query() dto: SearchQueryDto,
  ): Promise<{ success: true; data: SearchResponse }> {
    const data = await this.searchService.search(user, normalizeSearchQuery(dto));
    return { success: true, data };
  }
}
