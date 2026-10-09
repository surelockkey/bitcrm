import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import type { JwtUser } from '@bitcrm/types';
import { UpdateNumberingDto } from './dto/numbering.dto';
import { NumberingService } from './numbering.service';

@ApiTags('Numbering')
@ApiBearerAuth()
@Controller('numbering')
export class NumberingController {
  constructor(private readonly numbering: NumberingService) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'Settings → Numbering: the next client invoice / estimate numbers',
    description:
      '**Guard:** `settings.view`. Workiz "Next Invoice Id" / "Next Estimate Id": what the next CLIENT invoice and ' +
      'the next CLIENT estimate (documents with no job) will be numbered. A job invoice keeps the job number and a ' +
      "job estimate `<job number>-<n>`, as Workiz shows them — those never come from here. Job ids are coded (Workiz " +
      '"Use Coded"), never serial.',
  })
  async get() {
    return { success: true, data: await this.numbering.get() };
  }

  @Put()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Set the next client invoice / estimate numbers',
    description:
      '**Guard:** `settings.edit`. Partial: only the counters sent change. Each must be more than the last number ' +
      'handed out (400 names that number); a document that takes a number while the save is in flight wins (409). ' +
      'Cut-over: set these to the numbers after Workiz\'s last ones before the first client document is made here.',
  })
  async update(@Body() dto: UpdateNumberingDto, @CurrentUser() user: JwtUser) {
    return { success: true, data: await this.numbering.update(dto, user.id) };
  }
}
