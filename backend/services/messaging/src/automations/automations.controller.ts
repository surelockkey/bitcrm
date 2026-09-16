import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { AutomationsService } from './automations.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { DuplicateAutomationDto } from './dto/duplicate-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import { TestAutomationDto } from './dto/test-automation.dto';
import { AutomationRunsRepository } from './engine/automation-runs.repository';
import { AutomationRuleEngine } from './engine/rule-engine.service';

/**
 * `/api/messaging/automations` — the Automation Center (design §7.1, §10 M21),
 * `settings.view` / `settings.edit` like the messaging settings. The
 * technician-triggered sends (`POST …/on-my-way`, `POST …/late`) live in
 * `TechNoticesController`; being POST-only they never shadow `GET /:id`.
 */
@ApiTags('Messaging Automations')
@ApiBearerAuth()
@Controller('automations')
export class AutomationsController {
  constructor(
    private readonly service: AutomationsService,
    private readonly runs: AutomationRunsRepository,
    private readonly engine: AutomationRuleEngine,
  ) {}

  @Get()
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: 'List automation rules',
    description:
      '**Guard:** `settings.view`. The rules the service runs (`builtin: true` — New-job SMS to technicians, ' +
      'on-my-way, late) plus every imported Workiz rule kept as data (`enabled: false`, structure as exported). ' +
      'Alphabetical by name.',
  })
  async list() {
    const data = await this.service.list();
    return { success: true, data };
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Create an automation rule',
    description:
      '**Guard:** `settings.edit`. The rule the Automation Center writes — from a library recipe or from ' +
      'scratch. It is `source: bitcrm` / `specSource: user`, so the Workiz translator never rewrites it, and it ' +
      'is created switched off unless `enabled: true` is asked for; asking for that with a spec the engine ' +
      'cannot act on answers 422 `RULE_NOT_RUNNABLE`.',
  })
  async create(@Body() dto: CreateAutomationDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.create(dto, user);
    this.engine.invalidate();
    return { success: true, data };
  }

  @Post('migrate')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Write the translation of every imported Workiz rule to its row',
    description:
      '**Guard:** `settings.edit`. The translation is applied at read time anyway; this writes it so the specs ' +
      'can be edited and stop being recomputed. Idempotent, and it never touches a rule somebody edited by hand. ' +
      'Answers the coverage table (busiest Workiz rule first): what each rule became and, when it cannot run, why. ' +
      '`?dryRun=true` reports without writing.',
  })
  async migrate(@CurrentUser() user: JwtUser, @Query('dryRun') dryRun?: string) {
    const rows = await this.service.migrate(user, { dryRun: dryRun === 'true' });
    this.engine.invalidate();
    return {
      success: true,
      data: {
        rules: rows.length,
        runnable: rows.filter((r) => r.runnable).length,
        written: rows.filter((r) => r.written).length,
        coverage: rows,
      },
    };
  }

  @Get(':id')
  @RequirePermission('settings', 'view')
  @ApiOperation({ summary: 'One automation rule', description: '**Guard:** `settings.view`.' })
  async get(@Param('id') id: string) {
    const data = await this.service.get(id);
    return { success: true, data };
  }

  @Get(':id/runs')
  @RequirePermission('settings', 'view')
  @ApiOperation({
    summary: "One rule's last firings",
    description:
      '**Guard:** `settings.view`. Newest first, at most 50: when it fired, for which job, what each action did ' +
      'and — for a firing that did nothing — why. Kept for 30 days.',
  })
  async listRuns(@Param('id') id: string, @Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '', 10);
    const data = await this.runs.listByRule(id, Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : 20, 50));
    return { success: true, data };
  }

  @Post(':id/duplicate')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Copy an automation rule',
    description:
      '**Guard:** `settings.edit`. "Start from this one": the copy keeps the name (with "(copy)", or "(copy 2)" ' +
      'when that is taken), the spec as the original evaluates to today, the category, the description and the ' +
      'notify medium. It is always created switched off, with no firing history, owned here — the Workiz ' +
      'provenance and the counters stay with the original, and the copy is never re-translated.',
  })
  async duplicate(@Param('id') id: string, @Body() dto: DuplicateAutomationDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.duplicate(id, dto.name, user);
    this.engine.invalidate();
    return { success: true, data };
  }

  @Post(':id/test')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Try a rule against one job without sending anything',
    description:
      '**Guard:** `settings.edit`. Evaluates the rule against the job as it is now and renders every message it ' +
      'would send (`outcome: dry_run`), or answers why it would not fire. Nothing is sent, nothing is logged.',
  })
  async test(@Param('id') id: string, @Body() dto: TestAutomationDto) {
    const data = await this.engine.testRun(id, dto.dealId);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Delete an automation rule',
    description:
      '**Guard:** `settings.edit`. Removes the rule for good — imported Workiz rules included, they are data. ' +
      'A built-in rule (New-job SMS, on-my-way, late) answers 422 `BUILTIN_RULE_NOT_DELETABLE`: it lives in ' +
      'code, so switching it off is how you stop it. The rule\'s firing history is left to expire on its own TTL.',
  })
  async remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const data = await this.service.remove(id, user);
    this.engine.invalidate();
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Enable, disable or rename an automation rule',
    description:
      '**Guard:** `settings.edit`. A rule can be switched on once it has a runnable spec (built-in, translated ' +
      'from Workiz, or written here); one that has none answers 422 `RULE_NOT_RUNNABLE` with the reason. ' +
      'Disabling and renaming work for every rule; saving a `spec` makes the rule yours and stops it being ' +
      're-translated.',
  })
  async update(@Param('id') id: string, @Body() dto: UpdateAutomationDto, @CurrentUser() user: JwtUser) {
    const data = await this.service.update(id, dto, user);
    // The engine caches the enabled rules for a few seconds; an edit made
    // here should be live on the next event, not on the next cache miss.
    this.engine.invalidate();
    return { success: true, data };
  }
}
