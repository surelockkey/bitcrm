import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
import { CallFlowsService } from '../call-flows/call-flows.service';
import { ServiceAreaNumbersService } from '../common/service-area-numbers.service';
import { LinesHealthService } from './lines-health.service';
import { TelephonySettingsService } from '../telephony/telephony-settings.service';
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
    private readonly flows: CallFlowsService,
    private readonly areaNumbers: ServiceAreaNumbersService,
    private readonly linesHealth: LinesHealthService,
    private readonly settings: TelephonySettingsService,
    private readonly numberSettings: NumberSettingsRepository,
  ) {}

  @Put(':sid/technician-line')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Make this the technician dial-in line',
    description:
      '**Guard:** `settings.edit`. A workspace has exactly ONE technician ' +
      'line, so designating a number releases whichever number held it — no ' +
      'separate unset step, and no way to end up with two.',
  })
  async makeTechnicianLine(@Param('sid') sid: string) {
    const owned = await this.numbers.listOwned();
    const number = owned.find((n) => n.sid === sid);
    if (!number) throw new NotFoundException('That number is not in this workspace');

    const settings = await this.settings.setTechnicianLine(number.phoneNumber);
    return { success: true, data: settings };
  }

  @Delete(':sid/technician-line')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Stop using this number as the technician line',
    description:
      '**Guard:** `settings.edit`. Technicians can no longer dial in until ' +
      'another number is designated — the in-app call button is unaffected.',
  })
  async clearTechnicianLine(@Param('sid') sid: string) {
    const owned = await this.numbers.listOwned();
    const number = owned.find((n) => n.sid === sid);
    const current = await this.settings.technicianLine();
    // Only the number that actually holds it may release it, so a stale tab
    // cannot clear somebody else's designation.
    if (number && current === number.phoneNumber) {
      await this.settings.setTechnicianLine(null);
    }
    return { success: true, data: { technicianLine: await this.settings.technicianLine() } };
  }

  @Get('health/lines')
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'Is every number this workspace depends on still wired up?',
    description:
      '**Guard:** `settings.view`. Cross-checks each market number and the ' +
      'technician line against what the account owns and which active call ' +
      'flow answers it. This is what catches a number released weeks ago, ' +
      'whose market is still dialling clients from it.',
  })
  async linesHealthCheck() {
    const lines = await this.linesHealth.check();
    return {
      success: true,
      data: {
        lines,
        healthy: lines.every((l) => l.problems.length === 0),
      },
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List the account phone numbers',
    description:
      'Any authenticated user — the dialer uses this to offer caller-id choices.',
  })
  async list() {
    const [owned, technicianLine] = await Promise.all([
      this.numbers.listOwned(),
      this.settings.technicianLine(),
    ]);
    return {
      success: true,
      data: owned.map((n) => ({
        ...n,
        technicianLine: n.phoneNumber === technicianLine,
      })),
    };
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
    const data = await this.numberSettings.list();
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
    const data = await this.numberSettings.put(
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
    description:
      '**Guard:** `settings.edit`. Permanently releases the number. Refuses ' +
      'while a call flow answers it or a service area dials from it — pass ' +
      '`?force=1` to release anyway, which leaves those references dangling.',
  })
  async release(
    @Param('sid') sid: string,
    @Query('force') force?: string,
  ) {
    await this.numbers.release(sid, {
      force: force === '1',
      referencedBy: () => this.referencesTo(sid),
    });
    return { success: true, data: { sid, released: true } };
  }

  /**
   * What still points at this number, in words an operator can act on.
   *
   * Best-effort: a lookup that fails must not block a release, because the
   * alternative is a number nobody can ever give back.
   */
  private async referencesTo(sid: string): Promise<string[]> {
    const owned = await this.numbers.listOwned().catch(() => []);
    const number = owned.find((n) => n.sid === sid)?.phoneNumber;
    if (!number) return [];

    const [flows, areas] = await Promise.all([
      this.flows.list().catch(() => []),
      this.areaNumbers.listAll().catch(() => []),
    ]);

    return [
      ...flows
        .filter((f) => f.numbers?.includes(number))
        .map((f) => `the "${f.name}" call flow`),
      ...areas
        .filter((a) => a.callerId === number)
        .map((a) => `the ${a.name} service area`),
    ];
  }
}
