import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { InventoryLogService } from './inventory-log.service';
import { ListInventoryLogQueryDto } from './dto/list-inventory-log-query.dto';

@ApiTags('Inventory log')
@ApiBearerAuth()
@Controller('inventory-log')
export class InventoryLogController {
  constructor(private readonly inventoryLogService: InventoryLogService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'List the inventory audit log',
    description:
      '**Guard:** `reports.view` permission required. Item edits and stock movements, newest ' +
      'first, inside `from`/`to` (default: the current UTC month up to now; at most 24 months; ' +
      'a date-only `to` is the whole day). `productId` reads ' +
      "one item's history; `userId`, `action` and `search` (product name / SKU) filter on top. " +
      'Pages with `cursor`, which pins the window page one was read under.',
  })
  async list(@Query() query: ListInventoryLogQueryDto) {
    const { items, nextCursor } = await this.inventoryLogService.list(query);
    return {
      success: true,
      data: items,
      pagination: { nextCursor, count: items.length },
    };
  }

  // Before any parameter route, or the parameter route swallows it.
  @Get('count')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'How many log entries the window holds',
    description:
      '**Guard:** `reports.view` permission required. Takes the same filters as the list ' +
      '(`cursor` and `limit` are ignored) and answers `{ total, atLeast }` — the row count ' +
      'behind "Page 2 of 7". `atLeast` means a month hit its ceiling and the real number is ' +
      'higher, which the panel renders as `7+`. Cached for thirty seconds.',
  })
  async count(@Query() query: ListInventoryLogQueryDto) {
    const data = await this.inventoryLogService.count(query);
    return { success: true, data };
  }
}
