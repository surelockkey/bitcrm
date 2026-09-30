import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { Internal } from '../../common/decorators/internal.decorator';
import { DealBillingService } from './deal-billing.service';
import { SetDealTaxDto } from './dto/set-deal-tax.dto';
import { SetDealDiscountDto } from './dto/set-deal-discount.dto';
import { SetProductTaxableDto } from './dto/set-product-taxable.dto';
import { ReplaceAllDealProductsDto } from './dto/replace-all-deal-products.dto';
import { InvoiceLinkDto } from './dto/invoice-link.dto';
import { InternalTimelineDto } from './dto/internal-timeline.dto';

/**
 * Job tax / discount / totals, plus the internal routes the billing service
 * reads and writes. Registered before DealsController (see DealsModule) — every
 * path here carries a literal segment, so nothing shadows DealsController, and
 * DealsController's `GET internal/:id` can't swallow these three-segment paths.
 */
@ApiTags('Deals — Billing')
@ApiBearerAuth()
@Controller()
export class DealBillingController {
  constructor(private readonly service: DealBillingService) {}

  @Get(':id/totals')
  @RequirePermission('deals', 'view')
  @ApiOperation({
    summary: "The job's document totals",
    description:
      '**Guard:** `deals.view`. Subtotal → discount (split across taxable/non-taxable) → ' +
      'tax on the discounted taxable base → total, from `calculateDocumentTotals`.',
  })
  async getTotals(@Param('id') id: string) {
    const data = await this.service.getTotals(id);
    return { success: true, data };
  }

  @Patch(':id/tax')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: "Set the job's tax rate by hand",
    description:
      '**Guard:** `deals.edit`. `{taxRateId}` (active rate) or `null` for no tax. The job ' +
      'becomes `taxSource: manual`, so service-area/client changes stop re-resolving it.',
  })
  async setTax(@Param('id') id: string, @Body() dto: SetDealTaxDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.setTax(id, dto.taxRateId, user);
    return { success: true, data };
  }

  @Post(':id/tax/auto')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: "Re-resolve the job's tax automatically",
    description:
      '**Guard:** `deals.edit`. Tax-exempt client → service-area default → account default → none.',
  })
  async autoTax(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.service.autoTax(id, user);
    return { success: true, data };
  }

  @Patch(':id/discount')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: "Set or remove the job's discount",
    description: '**Guard:** `deals.edit`. `{discount: {type: amount|percent, value}}` or `{discount: null}`.',
  })
  async setDiscount(
    @Param('id') id: string,
    @Body() dto: SetDealDiscountDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.setDiscount(id, dto.discount, user);
    return { success: true, data };
  }

  @Patch(':id/products/:productId/taxable')
  @RequirePermission('deals', 'edit')
  @ApiOperation({
    summary: 'Toggle whether the job tax applies to a line',
    description: '**Guard:** `deals.edit`. Returns the updated line.',
  })
  async setProductTaxable(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: SetProductTaxableDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.service.setProductTaxable(id, productId, dto.taxable, user);
    return { success: true, data };
  }

  // Internal endpoints (billing service)

  @Get('internal/by-contact/:contactId')
  @Internal()
  @ApiOperation({
    summary: "Internal: a contact's deals (id, number, super-status, company)",
    description: '**Guard:** internal secret (`x-internal-secret`).',
  })
  async byContact(@Param('contactId') contactId: string) {
    const data = await this.service.listByContact(contactId);
    return { success: true, data };
  }

  @Get('internal/:id/billing-view')
  @Internal()
  @ApiOperation({
    summary: 'Internal: deal + items + totals for an invoice/estimate',
    description:
      '**Guard:** internal secret (`x-internal-secret`). ' +
      '`{deal, items, totals, jobTypeName?, technicianNames?}`.',
  })
  async billingView(@Param('id') id: string) {
    const data = await this.service.getBillingView(id);
    return { success: true, data };
  }

  @Put('internal/:id/products/replace-all')
  @Internal()
  @ApiOperation({
    summary: "Internal: overwrite the job's items with an estimate's (sync to job)",
    description:
      '**Guard:** internal secret (`x-internal-secret`). Restores stock of removed sourced ' +
      'lines, merges duplicates, sources stock products from the first assigned tech with ' +
      'enough (else to_order), rolls stock back on failure. Returns `{items, deal}`.',
  })
  async replaceAll(@Param('id') id: string, @Body() dto: ReplaceAllDealProductsDto) {
    const data = await this.service.replaceAllProducts(id, dto);
    return { success: true, data };
  }

  @Patch('internal/:id/invoice-link')
  @Internal()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Internal: link/unlink the job invoice',
    description: '**Guard:** internal secret (`x-internal-secret`). `{invoiceId: string | null}` → 204.',
  })
  async invoiceLink(@Param('id') id: string, @Body() dto: InvoiceLinkDto): Promise<void> {
    await this.service.setInvoiceLink(id, dto.invoiceId);
  }

  @Post('internal/:id/timeline')
  @Internal()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Internal: add a timeline entry to a job',
    description:
      '**Guard:** internal secret (`x-internal-secret`). `{type, actorId, actorName?, metadata?}` → 204.',
  })
  async addTimeline(@Param('id') id: string, @Body() dto: InternalTimelineDto): Promise<void> {
    await this.service.addTimeline(id, dto);
  }
}
