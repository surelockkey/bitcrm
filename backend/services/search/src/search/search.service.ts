import { Injectable, Logger, Optional } from '@nestjs/common';
import { JwtUser, SearchResponse } from '@bitcrm/types';
import { BusinessMetricsService } from '@bitcrm/shared';
import { OpenSearchService } from '../common/opensearch/opensearch.service';
import { SEARCH_INDEX_ALIAS } from '../common/constants/opensearch.constants';
import { PermissionsResolver } from './permissions-resolver.service';
import { buildAuthorizationClause } from './authz/search-authz.builder';
import { buildSearchBody } from './search-query.builder';
import { parseSearchResponse } from './search-response.parser';
import { NormalizedSearchQuery } from './dto/search-query.dto';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly opensearch: OpenSearchService,
    private readonly permissions: PermissionsResolver,
    @Optional() private readonly metrics?: BusinessMetricsService,
  ) {}

  async search(
    user: JwtUser,
    query: NormalizedSearchQuery,
  ): Promise<SearchResponse> {
    // Empty query → empty result (avoid a match-all scan).
    if (!query.q) {
      return { query: '', mode: query.mode, groups: [], took: 0 };
    }

    const resolved = await this.permissions.resolve(user);
    const authzClause = buildAuthorizationClause(
      { id: user.id, department: user.department },
      resolved,
    );

    const body = buildSearchBody({
      q: query.q,
      authzClause,
      mode: query.mode,
      types: query.types,
      perTypeLimit: query.perTypeLimit,
      page: query.page,
      size: query.size,
    });

    // Optional custom metric — tolerated if the shared metrics service lacks it.
    const timer = (this.metrics as any)?.searchQueryDuration?.startTimer?.({ mode: query.mode });
    try {
      const res = await this.opensearch.client.search({
        index: SEARCH_INDEX_ALIAS,
        body,
      });
      timer?.();
      return parseSearchResponse((res as any).body, {
        query: query.q,
        mode: query.mode,
        page: query.page,
        size: query.size,
      });
    } catch (err) {
      timer?.();
      this.logger.error(`Search failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
