import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { TaxRatesService } from './tax-rates.service';
import { ListTaxRatesQueryDto } from './dto/list-tax-rates-query.dto';
import { Internal } from '../common/decorators/internal.decorator';

/**
 * Read-only: rates are configured on service areas (`tax`), one per area, and
 * exposed here with `id === serviceAreaId`. There are no write endpoints.
 */
@ApiTags('Tax Rates')
@ApiBearerAuth()
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly service: TaxRatesService) {}

  @Get()
  @RequirePermission('tax_rates', 'view')
  @ApiOperation({
    summary: 'List tax rates (derived from service areas)',
    description:
      '**Guard:** `tax_rates.view`. One rate per service area that has a sales tax ' +
      '(`id` = area id, plus `serviceAreaId`/`serviceAreaName`), sorted by name. Rates of ' +
      'archived areas only with `?includeInactive=true`.',
  })
  async list(@Query() query: ListTaxRatesQueryDto) {
    const data = await this.service.list({ includeInactive: query.includeInactive === 'true' });
    return { success: true, data };
  }

  @Get('internal')
  @Internal()
  @ApiOperation({
    summary: 'Internal: every derived tax rate (archived areas included)',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async listInternal() {
    const data = await this.service.listAll();
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('tax_rates', 'view')
  @ApiOperation({
    summary: 'Get a tax rate by id (= service area id)',
    description: '**Guard:** `tax_rates.view`. 404 when the area is unknown or has no tax.',
  })
  async findById(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, data };
  }
}

/**
 * `GET /api/deals/internal/tax-rates` — the path the billing service reads.
 * Lives in this module (registered before DealsModule) so DealsController's
 * `GET internal/:id` can't capture "tax-rates" as a deal id.
 */
@ApiTags('Tax Rates')
@Controller('internal')
export class TaxRatesInternalController {
  constructor(private readonly service: TaxRatesService) {}

  @Get('tax-rates')
  @Internal()
  @ApiOperation({
    summary: 'Internal: every derived tax rate (archived areas included)',
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async list() {
    const data = await this.service.listAll();
    return { success: true, data };
  }
}
