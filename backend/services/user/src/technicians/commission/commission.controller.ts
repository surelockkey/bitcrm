import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { CommissionService } from './commission.service';
import { SetCommissionDto } from './dto/set-commission.dto';
import { CalculateCommissionQueryDto } from './dto/calculate-commission-query.dto';

@ApiTags('Technician Commission')
@ApiBearerAuth()
@Controller('technicians')
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  @Get(':id/commission')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Get current commission config',
    description: '**Guard:** `commission.view` permission required. Manager+ or self.',
  })
  async get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.commissionService.getConfig(id, user);
    return { success: true, data };
  }

  @Get(':id/commission/history')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Get commission config history',
    description:
      '**Guard:** `commission.view` permission required. Manager+ or self. ' +
      'Returns all versions (newest first) — historical rates are preserved for reporting.',
  })
  async history(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.commissionService.getHistory(id, user);
    return { success: true, data };
  }

  @Get(':id/commission/calculate')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Calculate a payout for given deal inputs',
    description:
      '**Guard:** `commission.view` permission required. Manager+ or self. ' +
      'Uses the technician’s latest commission config.',
  })
  async calculate(
    @Param('id') id: string,
    @Query() query: CalculateCommissionQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.commissionService.calculate(id, query, user);
    return { success: true, data };
  }

  @Post(':id/commission')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Set/update commission config (new version)',
    description:
      '**Guard:** `commission.edit` permission required. Manager+. ' +
      'Writes a new effective-dated version; publishes `commission.updated`.',
  })
  async set(
    @Param('id') id: string,
    @Body() dto: SetCommissionDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.commissionService.setConfig(id, dto, user);
    return { success: true, data };
  }
}
