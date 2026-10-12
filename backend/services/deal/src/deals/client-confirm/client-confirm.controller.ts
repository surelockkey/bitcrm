import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Internal } from '../../common/decorators/internal.decorator';
import { ClientConfirmService } from './client-confirm.service';
import { ClientConfirmDto } from './dto/client-confirm.dto';

/**
 * The job half of the client's "confirm your appointment" page (B12, Workiz
 * `{{confirm_link}}`). Billing's `@Public` `/billing/public/confirm/:token`
 * verifies the link's token and calls these; nothing here is reachable from
 * a browser. Registered before DealsController (three-segment `internal/…`
 * paths, like the billing ones).
 */
@ApiTags('Deals — Client confirmation')
@Controller()
export class ClientConfirmController {
  constructor(private readonly service: ClientConfirmService) {}

  @Get('internal/:id/client-confirm')
  @Internal()
  @ApiOperation({
    summary: 'Internal: the job as the client’s confirm page shows it',
    description:
      '**Guard:** internal secret (`x-internal-secret`). `ClientConfirmJob`: the visit (wall clock in the job’s ' +
      'zone), address, job type, company and `state` — open | confirmed | closed | expired. 404 for no such job.',
  })
  async view(@Param('id') id: string) {
    return { success: true, data: await this.service.view(id) };
  }

  @Post('internal/:id/client-confirm')
  @Internal()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Internal: the client confirms the visit',
    description:
      '**Guard:** internal secret (`x-internal-secret`). While the state is `open`: stamps `clientConfirmedAt` / ' +
      '`Via` / `By` / `For` (conditional — one confirmation per visit), writes "Client Confirmed job" ' +
      '(`client_confirmed`) to the history and publishes `deal.client_confirmed`. No sub-status is set. ' +
      'Idempotent: any other state, a repeat tap or a lost race changes nothing; `recorded` says which.',
  })
  async confirm(@Param('id') id: string, @Body() dto: ClientConfirmDto) {
    return { success: true, data: await this.service.confirm(id, dto) };
  }
}
