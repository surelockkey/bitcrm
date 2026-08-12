import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { type Response } from 'express';
import { Readable } from 'stream';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { Inject } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallEventsBus } from './call-events.bus';
import {
  LIVE_STATUSES,
  type CallRecord,
  type CallStatus,
} from './calls.repository';
import { ConferenceService, type MonitorMode } from '../voice/conference.service';
import { UserNamesService, type UserSummary } from '../common/user-names.service';
import {
  ContactLookupService,
  type CallContact,
} from '../common/contact-lookup.service';
import {
  UserPhoneLookupService,
  type CallUserPhone,
} from '../common/user-phone-lookup.service';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';

const SSE_HEARTBEAT_MS = 25_000;

class MonitorDto {
  mode!: MonitorMode;
}

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('calls')
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly bus: CallEventsBus,
    private readonly conferenceService: ConferenceService,
    private readonly userNames: UserNamesService,
    private readonly contacts: ContactLookupService,
    private readonly userPhones: UserPhoneLookupService,
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
  ) {}

  /**
   * Name both sides of every call. Three lookups, all batched across the page
   * and all best-effort — a party we can't name renders as a bare number:
   *
   * - system users on the call as softphone participants (agent + participants)
   * - system users reached on their **personal** number, matched by endpoint
   * - everyone else, matched against CRM contacts
   *
   * A number that belongs to one of our people is deliberately resolved as
   * that person, not as a client, even if a contact record also carries it.
   */
  private async withNames(records: CallRecord[]): Promise<CallRecord[]> {
    const ids = records.flatMap((r) => [
      ...(r.agentId ? [r.agentId] : []),
      ...(r.participants?.map((p) => p.userId) ?? []),
    ]);
    const phones = records.flatMap((r) => [
      ...(r.from ? [r.from] : []),
      ...(r.to ? [r.to] : []),
    ]);
    if (ids.length === 0 && phones.length === 0) return records;

    const [users, contacts, personals] = await Promise.all([
      ids.length
        ? this.userNames.resolve(ids)
        : Promise.resolve<Record<string, UserSummary>>({}),
      phones.length
        ? this.contacts.resolve(phones)
        : Promise.resolve<Record<string, CallContact>>({}),
      phones.length
        ? this.userPhones.resolve(phones)
        : Promise.resolve<Record<string, CallUserPhone>>({}),
    ]);

    return records.map((r) => {
      const agent = r.agentId ? users[r.agentId] : undefined;
      const fromPersonal = r.from ? personals[r.from] : undefined;
      const toPersonal = r.to ? personals[r.to] : undefined;
      // Ours beats theirs: a number on a teammate's profile is that teammate,
      // even if some contact record happens to carry it too.
      const from = fromPersonal ? undefined : r.from ? contacts[r.from] : undefined;
      const to = toPersonal ? undefined : r.to ? contacts[r.to] : undefined;
      return {
        ...r,
        ...(agent ? { agentName: agent.name, agentRoleId: agent.roleId } : {}),
        ...(from ? { fromContact: from } : {}),
        ...(to ? { toContact: to } : {}),
        ...(fromPersonal ? { fromPersonal } : {}),
        ...(toPersonal ? { toPersonal } : {}),
        ...(r.participants
          ? {
              participants: r.participants.map((p) => {
                const u = users[p.userId];
                return u ? { ...p, name: u.name, roleId: u.roleId } : p;
              }),
            }
          : {}),
      };
    });
  }

  /* NOTE: static routes are declared before ':sid' so they aren't swallowed. */

  @Get()
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'List all calls (global log)',
    description:
      '**Guard:** `calls.view` permission required. Newest first; cursor ' +
      'pagination; filters: direction, status, agentId, number (substring), ' +
      'numbers (comma-separated, matches any — a client\'s phone list), ' +
      'dateFrom/dateTo (ISO instants or prefixes). Parties are named on the ' +
      'way out: system users from user-service, outside callers from CRM ' +
      'contacts.',
  })
  async list(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('direction') direction?: string,
    @Query('status') status?: string,
    @Query('agentId') agentId?: string,
    @Query('number') number?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    // Appended, not slotted in next to `number`: Nest injects by decorator,
    // but direct callers (tests) pass positionally.
    @Query('numbers') numbers?: string,
  ) {
    // Query DTOs aren't transformed in this codebase — coerce in-service.
    const parsedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    // Comma-separated, capped: each number adds two contains() to the filter.
    const parsedNumbers = numbers
      ? numbers.split(',').map((n) => n.trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const result = await this.callsService.list(
      { direction, status, agentId, number, numbers: parsedNumbers, dateFrom, dateTo },
      cursor,
      parsedLimit,
    );
    return {
      success: true,
      data: await this.withNames(result.items),
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('live')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'Currently live calls',
    description:
      '**Guard:** `calls.view` permission required. Non-terminal calls from ' +
      'the last 24h, newest first.',
  })
  async live() {
    const data = await this.callsService.listLive();
    return { success: true, data: await this.withNames(data) };
  }

  @Get('stream')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'Server-sent events stream of call updates',
    description:
      '**Guard:** `calls.view` permission required. Emits `call.upserted` / ' +
      '`call.recording_ready` events as SSE data frames; heartbeat comments ' +
      'keep the connection alive through proxies.',
  })
  stream(@Res() res: Response): void {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Tell nginx not to buffer this response — required for live delivery.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const subscription = this.bus.stream().subscribe((event) => {
      // Names come from the cached resolver — the live UI must show users
      // exactly like the initial fetch does, or SSE patches would erase them.
      void this.withNames([event.call])
        .then(([call]) =>
          res.write(`data: ${JSON.stringify({ ...event, call })}\n\n`),
        )
        .catch(() => res.write(`data: ${JSON.stringify(event)}\n\n`));
    });
    const heartbeat = setInterval(
      () => res.write(': hb\n\n'),
      SSE_HEARTBEAT_MS,
    );

    res.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      res.end();
    });
  }

  @Get('recent')
  @ApiOperation({
    summary: "The current agent's recent calls",
    description: 'Newest first, from the AgentIndex GSI. Any authenticated user.',
  })
  async recent(@CurrentUser() user: JwtUser) {
    const data = await this.callsService.listByAgent(user.id);
    return { success: true, data };
  }

  @Get(':sid')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'A single call record',
    description: '**Guard:** `calls.view` permission required.',
  })
  async detail(@Param('sid') sid: string) {
    const data = await this.callsService.getBySid(sid);
    if (!data) throw new NotFoundException('Call not found');
    const [enriched] = await this.withNames([data]);
    return { success: true, data: enriched };
  }

  @Get(':sid/recording')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: "Stream a call's recording (mp3)",
    description:
      '**Guard:** `calls.view` permission required. Proxies the media from ' +
      'Twilio with server-side auth; the browser plays it via a blob URL.',
  })
  async recording(@Param('sid') sid: string, @Res() res: Response) {
    const call = await this.callsService.getBySid(sid);
    if (!call?.recordingSid) {
      throw new NotFoundException('No recording for this call');
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Recordings/${call.recordingSid}.mp3`;
    const auth = Buffer.from(
      `${this.config.accountSid}:${this.config.authToken}`,
    ).toString('base64');

    const upstream = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!upstream.ok || !upstream.body) {
      throw new HttpException('Recording unavailable', 502);
    }

    res.set({
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      ...(upstream.headers.get('content-length') && {
        'Content-Length': upstream.headers.get('content-length')!,
      }),
    });
    Readable.fromWeb(upstream.body as never).pipe(res);
  }

  @Post(':sid/monitor')
  @RequirePermission('calls', 'join')
  @ApiOperation({
    summary: 'Request to listen to / join a live call',
    description:
      '**Guard:** `calls.join` permission required. Issues a short-lived, ' +
      'single-use grant; the softphone then connects with ' +
      '`{Monitor: conferenceName, MonitorMode: mode}`. 409 when the call ' +
      'is not live.',
  })
  async monitor(
    @Param('sid') sid: string,
    @Body() dto: MonitorDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (dto.mode !== 'listen' && dto.mode !== 'join') {
      throw new BadRequestException('mode must be "listen" or "join"');
    }
    const call = await this.callsService.getBySid(sid);
    if (!call) throw new NotFoundException('Call not found');
    if (
      !call.conferenceName ||
      !call.status ||
      !LIVE_STATUSES.includes(call.status as CallStatus)
    ) {
      throw new ConflictException('This call is not live');
    }

    await this.conferenceService.grantMonitor(
      user.id,
      call.conferenceName,
      dto.mode,
    );
    return { success: true, data: { conferenceName: call.conferenceName } };
  }
}
