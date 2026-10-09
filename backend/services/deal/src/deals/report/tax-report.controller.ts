import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import {
  TAX_REPORT_BASES,
  TAX_REPORT_BY,
  type JwtUser,
  type ResolvedPermissions,
  type TaxReportBasis,
  type TaxReportBy,
} from '@bitcrm/types';
import { ResolvedPerms } from '../../common/decorators/resolved-permissions.decorator';
import { TaxReportService } from './tax-report.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class TaxReportQueryDto {
  @ApiPropertyOptional({ enum: TAX_REPORT_BASES, description: 'Accrual (default) or Paid.' })
  @IsOptional()
  @IsIn(TAX_REPORT_BASES as unknown as string[])
  basis?: TaxReportBasis;

  @ApiPropertyOptional({ enum: TAX_REPORT_BY, description: 'Accrual only: created | scheduled (Job date) | end (Job end date, default).' })
  @IsOptional()
  @IsIn(TAX_REPORT_BY as unknown as string[])
  by?: TaxReportBy;

  @ApiProperty({ example: '2026-09-01', description: 'First day (America/New_York), inclusive.' })
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @ApiProperty({ example: '2026-09-27', description: 'Last day, inclusive; at most 366 days after `from`.' })
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  @ApiPropertyOptional({ description: '"Tax to show": a row key `<name>|<percent>`, from `taxes`.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tax?: string;

  @ApiPropertyOptional({ description: 'Tax name contains.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

const HELP =
  'Accrual: every job whose tax is not zero, windowed on `by` (created | scheduled = Job date | end = Job end ' +
  'date, the default) in the account’s days; per rate Amount = Σ tax, Taxable = Σ taxable base, Non-taxable = ' +
  'Σ (subtotal − taxable base) — negative when a discount outweighs the untaxed lines. Paid: jobs that collected ' +
  'money in the window (payment date, tips out, refunds netted); Tax = Σ taxable base × rate × min(1, collected / ' +
  'job total), summed unrounded and rounded once per rate (Workiz), Taxable = the jobs’ full taxable base. Rate ' +
  'rounded to two places. `taxes` — the "Tax to show" options — lists every tax the account has (service areas, ' +
  'archived ones too) and any other rate the window’s jobs carried, once per name and percent, A→Z.';

/**
 * Workiz Reports → Tax. Declared ahead of `DealsController` in the module
 * (as the Jobs report is), so no `/:id…` route takes `report/tax`.
 */
@ApiTags('Tax report')
@ApiBearerAuth()
@Controller('report/tax')
export class TaxReportController {
  constructor(private readonly tax: TaxReportService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Tax report — one row per tax rate',
    description: `**Guard:** \`reports.view\` **and** \`financials.view\` (the report is nothing but money). DataScope: \`deals\`. ${HELP} → \`{ basis, by?, from, to, rows, totalAmount, taxes }\`.`,
  })
  async report(
    @Query() query: TaxReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    return { success: true, data: await this.tax.report(query, { user, perms }) };
  }

  @Get('export')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The Tax report as CSV',
    description:
      '**Guard:** `reports.view` **and** `financials.view`. Workiz’s CSV: Accrual — Name, Description, Rate, Amount, ' +
      'Taxable amount, Non taxable amount, Jobs count; Paid — Name, Description, Rate, Tax, Taxable amount, Jobs count. ' +
      'Numbers bare (no `$`, no `%`). → `{ filename, csv, count, truncated }`.',
  })
  async export(
    @Query() query: TaxReportQueryDto,
    @CurrentUser() user: JwtUser,
    @ResolvedPerms() perms: ResolvedPermissions,
  ) {
    return { success: true, data: await this.tax.exportCsv(query, { user, perms }) };
  }
}
