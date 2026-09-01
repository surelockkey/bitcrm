import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { IsOptional, IsString, ValidateIf } from 'class-validator';
import { RequirePermission, CurrentUser } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { NumbersService } from './numbers.service';
import { NumberSettingsRepository } from './number-settings.repository';

class BuyNumberDto {
  phoneNumber!: string;
}

class UpdateNumberSettingsDto {
  @ApiPropertyOptional({
    description: 'Job-source catalog id; null clears the assignment.',
    example: 'a2b6f9d0-...',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  sourceId?: string | null;
}

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('numbers')
export class NumbersController {
  constructor(
    private readonly numbers: NumbersService,
    private readonly settings: NumberSettingsRepository,
  ) {}

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

  @Get('settings')
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'Per-number settings (job source assignments)',
    description:
      '**Guard:** `settings.view`. Every number with settings; numbers ' +
      'without an entry have none.',
  })
  async listSettings() {
    const data = await this.settings.list();
    return { success: true, data };
  }

  @Put(':phoneNumber/settings')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: "Assign the number's job source",
    description:
      '**Guard:** `settings.edit`. Calls through the number are attributed ' +
      'to this job source from now on; `sourceId: null` clears it.',
  })
  async updateSettings(
    @Param('phoneNumber') phoneNumber: string,
    @Body() dto: UpdateNumberSettingsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const data = await this.settings.put(
      phoneNumber,
      { sourceId: dto.sourceId },
      user.id,
    );
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
