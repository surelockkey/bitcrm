import { Controller, Get, Headers, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission, hasPermission } from '@bitcrm/shared';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { DispatchMapService } from './dispatch-map.service';
import { DISPATCH_MAP_MAX_DAYS, DispatchMapQueryDto } from './dispatch-map.query';

/**
 * The dispatch map's one read. Declared ahead of `DealsController` in the
 * module, or its `GET /:id` would take `/map`.
 */
@ApiTags('Dispatch map')
@ApiBearerAuth()
@Controller('map')
export class DispatchMapController {
  constructor(private readonly map: DispatchMapService) {}

  @Get()
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: 'Every job the dispatch map draws, and who they name, in one request',
    description:
      '**Guard:** `deals.view` permission required. DataScope enforced — under `assigned_only` only the caller’s own ' +
      'jobs. With no `statuses`, the four open super-statuses, each read whole whatever its date (Workiz `map/getJobs`); ' +
      '`statuses` (comma list) narrows them, and `done` / `canceled` are read only for `from`..`to` (visit days, ' +
      `YYYY-MM-DD, at most ${DISPATCH_MAP_MAX_DAYS}). No page cap and no cursor: \`pagination.count\` is the whole set. ` +
      'Rows are `Deal`s projected to what the map draws (pin, cards, a tech’s day, the search) — open the job for the ' +
      'rest. `included` carries the technicians on them (names only) and their clients as crm shows them to the caller ' +
      '(names, numbers masked without `contacts.view_numbers`, emails); a job’s own `phones` likewise only with ' +
      '`contacts.view_numbers`.',
  })
  async read(
    @Query() query: DispatchMapQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
    @Headers('authorization') authorization?: string,
  ) {
    const { deals, included } = await this.map.read(query, user, perms?.dataScope?.deals, {
      numbers: hasPermission(perms, 'contacts', 'view_numbers'),
      authorization,
    });
    return { success: true, data: deals, pagination: { count: deals.length }, included };
  }
}
