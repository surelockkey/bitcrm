import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { OptOutsService } from './opt-outs.service';
import { ImportOptOutsDto, LookupOptOutsQueryDto, SetOptOutDto } from './dto/opt-out.dto';

/**
 * `/api/messaging/opt-outs` — `settings.view` / `settings.edit` (design
 * §7.1, §7.5). Static routes (`import`) are declared before the
 * `:channel/:address` ones.
 */
@ApiTags('Opt-outs')
@ApiBearerAuth()
@Controller('opt-outs')
export class OptOutsController {
  constructor(private readonly service: OptOutsService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'Look an address up',
    description:
      '**Guard:** `settings.view`. `?address=` (phone in any form, or email) → the opt-out rows found for it, ' +
      'per channel; an empty array means never opted out. There is no table-wide listing (see the service).',
  })
  async lookup(@Query() query: LookupOptOutsQueryDto) {
    const data = await this.service.lookup(query.address);
    return { success: true, data };
  }

  @Post('import')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Import opt-outs (the Workiz STOP list)',
    description:
      '**Guard:** `settings.edit`. `{ items: [{ address, channel, status?, source?, keyword?, at? }], overwrite? }`, ' +
      'up to 1 000 per call. Existing rows are skipped unless `overwrite`; invalid addresses are reported in ' +
      '`invalid`. Returns `{ imported, skipped, invalid }`.',
  })
  async import(@Body() dto: ImportOptOutsDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.import(dto, user);
    return { success: true, data };
  }

  @Get(':channel/:address')
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'One opt-out record', description: '**Guard:** `settings.view`. 404 when the address never opted out.' })
  @ApiParam({ name: 'channel', enum: ['sms', 'email'] })
  async get(@Param('channel') channel: string, @Param('address') address: string) {
    const data = await this.service.get(this.service.assertChannel(channel), address);
    return { success: true, data };
  }

  @Put(':channel/:address')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Set an address opted out / opted in by hand',
    description:
      '**Guard:** `settings.edit`. `{ status: opted_out|opted_in, keyword? }`; recorded as `source: manual` with ' +
      'the caller in the history. Creates the row when there is none.',
  })
  @ApiParam({ name: 'channel', enum: ['sms', 'email'] })
  async set(
    @Param('channel') channel: string,
    @Param('address') address: string,
    @Body() dto: SetOptOutDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.set(this.service.assertChannel(channel), address, dto, user);
    return { success: true, data };
  }

  @Delete(':channel/:address')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Remove an opt-out record',
    description: '**Guard:** `settings.edit`. Drops the row and its history; prefer `PUT … { status: "opted_in" }`.',
  })
  @ApiParam({ name: 'channel', enum: ['sms', 'email'] })
  async remove(@Param('channel') channel: string, @Param('address') address: string, @CurrentUser() user: JwtUser) {
    await this.service.remove(this.service.assertChannel(channel), address, user);
    return { success: true, data: { channel, address, deleted: true } };
  }
}
