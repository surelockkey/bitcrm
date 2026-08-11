import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequirePermission } from '@bitcrm/shared';
import { NumbersService } from './numbers.service';

class BuyNumberDto {
  phoneNumber!: string;
}

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('numbers')
export class NumbersController {
  constructor(private readonly numbers: NumbersService) {}

  @Get()
  @ApiOperation({
    summary: 'List the account phone numbers',
    description:
      'Any authenticated user — the dialer uses this to offer caller-id choices.',
  })
  async list() {
    const data = await this.numbers.listOwned();
    return { success: true, data };
  }

  @Get('available')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Search purchasable phone numbers',
    description: '**Guard:** `settings.edit`. Query: country, areaCode, contains.',
  })
  async available(
    @Query('country') country?: string,
    @Query('areaCode') areaCode?: string,
    @Query('contains') contains?: string,
  ) {
    const data = await this.numbers.searchAvailable({
      country,
      areaCode: areaCode ? Number(areaCode) : undefined,
      contains,
    });
    return { success: true, data };
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Buy a phone number',
    description: '**Guard:** `settings.edit`. Provisions it with the inbound webhook.',
  })
  async buy(@Body() dto: BuyNumberDto) {
    const data = await this.numbers.buy(dto.phoneNumber);
    return { success: true, data };
  }

  @Delete(':sid')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Release (delete) a phone number',
    description: '**Guard:** `settings.edit`. Permanently releases the number.',
  })
  async release(@Param('sid') sid: string) {
    await this.numbers.release(sid);
    return { success: true, data: { sid, released: true } };
  }
}
