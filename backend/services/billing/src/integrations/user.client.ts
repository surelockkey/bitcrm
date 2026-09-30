import { Inject, Injectable, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { USER_SERVICE_URL } from '../common/constants/services.constants';
import { INTERNAL_FETCH, InternalHttp, defaultFetch, type FetchLike } from './internal-http';

export interface UserName {
  id: string;
  firstName?: string;
  lastName?: string;
}

/**
 * User-service reads (existing internal route):
 *   POST /api/users/internal/names-by-ids   `{ userIds }` → `{ id, firstName, lastName }[]`, at most 200
 */
@Injectable()
export class UserClient {
  private readonly http: InternalHttp;

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) fetchImpl?: FetchLike,
    @Optional() metrics?: BusinessMetricsService,
  ) {
    this.http = new InternalHttp('user', USER_SERVICE_URL, fetchImpl ?? defaultFetch, metrics);
  }

  async namesByIds(ids: string[]): Promise<UserName[]> {
    if (ids.length === 0) return [];
    return (
      (await this.http.request<UserName[]>('/api/users/internal/names-by-ids', {
        method: 'POST',
        body: { userIds: ids.slice(0, 200) },
        operation: 'namesByIds',
      })) ?? []
    );
  }
}
