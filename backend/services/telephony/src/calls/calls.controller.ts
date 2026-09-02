import {
  BadRequestException,
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
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
  identifyNumber,
  partyStorage,
  resolveParties,
  storedParties,
  type CallPartyRef,
  type EnrichedCall,
  type PartyLookups,
  type ResolvedParties,
} from './party-resolver';
import {
  ContactLookupService,
  type CallContact,
} from '../common/contact-lookup.service';
import {
  UserPhoneLookupService,
  type CallUserPhone,
} from '../common/user-phone-lookup.service';
import { UserDirectoryService } from '../common/user-directory.service';
import { PermissionLookupService } from '../common/permission-lookup.service';
import { BridgeService } from '../common/bridge.service';
import { PresenceService } from '../presence/presence.service';
import { TwilioRest } from '../common/twilio-client';
import { maskCall, maskCalls } from './call-masking';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';

const SSE_HEARTBEAT_MS = 25_000;
/**
 * How long the technician's own handset rings on a masked bridge. Twilio adds
 * up to a 5-second buffer to this, so the effective ring is ~20s — under the
 * ~25s at which most carriers hand over to voicemail. That margin is a nicety,
 * not a defence: the whisper gather is what actually stops a voicemail box
 * taking the call.
 */
const BRIDGE_RING_SECONDS = Number(
  process.env.TELEPHONY_BRIDGE_RING_SECONDS ?? 15,
);

/** The body of POST /calls/bridge — a handle, never a phone number. */
/** Which end of the call rings the person placing it. */
export type BridgeVia = 'cell' | 'softphone';

class StartBridgeDto {
  dealId!: string;
  contactId!: string;
  /** Which of the client's numbers to ring. Defaults to the first. */
  phoneIndex?: number;
  /**
   * Which end rings the caller: their own handset, or the browser softphone.
   * Omitted, presence decides — which is a good default and a bad rule, since
   * a technician with the app open on a laptop in the van still wants the call
   * on the phone in their hand.
   */
  via?: BridgeVia;
}

class MonitorDto {
  mode!: MonitorMode;
}

class TakeCompleteDto {
  /** The legs this hand-over is replacing, as reported by `/take`. */
  previousLegs!: string[];
}

class AddParticipantDto {
  userId!: string;
  channel!: 'softphone' | 'personal';
  /** True = transfer (release my leg so I can hang up), false = just add. */
  handOver?: boolean;
}

class SetDealDto {
  /** null detaches. */
  dealId!: string | null;
}

class SetPartyDto {
  side!: 'from' | 'to';
  /** null clears the side. */
  kind!: 'user' | 'contact' | 'company' | null;
  id!: string;
}

@ApiTags('Telephony')
@ApiBearerAuth()
@Controller('calls')
export class CallsController {
  private readonly logger = new Logger(CallsController.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly bus: CallEventsBus,
    private readonly conferenceService: ConferenceService,
    private readonly userNames: UserNamesService,
    private readonly contacts: ContactLookupService,
    private readonly userPhones: UserPhoneLookupService,
    private readonly directory: UserDirectoryService,
    private readonly permissions: PermissionLookupService,
    private readonly bridge: BridgeService,
    private readonly presence: PresenceService,
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
  /**
   * Resolve the viewer's `contacts.view_numbers` grant once per request.
   * Memoised for 60s inside the lookup service, so the softphone's 5s poll of
   * /calls/active costs one Redis read a minute rather than twelve.
   */
  private maySeeNumbers(user: JwtUser | undefined): Promise<boolean> {
    return this.permissions.maySeeClientNumbers(user);
  }

  private async withNames(records: CallRecord[]): Promise<EnrichedCall[]> {
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

    const lookups: PartyLookups = { users, personals, contacts };

    // Frozen client associations carry only an id; fetch their current names
    // so a renamed client reads correctly on calls from years ago.
    const parties = records.map((r) => this.partiesFor(r, lookups));
    const refs = parties.flatMap((p) =>
      [p.from, p.to].flatMap((party) =>
        party && party.kind !== 'user' && !party.name
          ? [{ kind: party.kind, id: party.id }]
          : [],
      ),
    );
    const refNames = refs.length ? await this.contacts.resolveRefs(refs) : {};
    const withName = (party?: CallPartyRef) =>
      party && !party.name && party.kind !== 'user'
        ? { ...party, name: refNames[`${party.kind}:${party.id}`] }
        : party;

    return records.map((r, i) => {
      const agent = r.agentId ? users[r.agentId] : undefined;
      const from = withName(parties[i].from);
      const to = withName(parties[i].to);

      return {
        ...r,
        ...(agent ? { agentName: agent.name, agentRoleId: agent.roleId } : {}),
        ...(from ? { fromParty: from } : {}),
        ...(to ? { toParty: to } : {}),
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

  /**
   * The parties for one record: the frozen association when there is one,
   * otherwise resolved from the numbers — and, once the call has ended,
   * written back so the next read and the party index use the settled answer.
   * Fire-and-forget: naming a call must never fail on a write.
   */
  private partiesFor(call: CallRecord, lookups: PartyLookups): ResolvedParties {
    const stored = storedParties(call);
    if (stored.from || stored.to) return this.nameStored(stored, lookups);

    const resolved = resolveParties(call, lookups);
    const live = !!call.status && LIVE_STATUSES.includes(call.status);
    if (!live && (resolved.from || resolved.to)) {
      void this.callsService
        .freezeParties(
          call.callSid,
          { from: partyStorage(resolved.from), to: partyStorage(resolved.to) },
          call.startedAt,
        )
        .catch(() => undefined);
    }
    return resolved;
  }

  /** Put today's names on a frozen association. */
  private nameStored(
    stored: ResolvedParties,
    lookups: PartyLookups,
  ): ResolvedParties {
    const named = (party?: CallPartyRef): CallPartyRef | undefined => {
      if (!party || party.kind !== 'user') return party;
      const user = lookups.users[party.id];
      return user ? { ...party, name: user.name, roleId: user.roleId } : party;
    };
    return { from: named(stored.from), to: named(stored.to) };
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
    @Query('origin') origin?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    // Query DTOs aren't transformed in this codebase — coerce in-service.
    const parsedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    // Comma-separated, capped: each number adds two contains() to the filter.
    const parsedNumbers = numbers
      ? numbers.split(',').map((n) => n.trim()).filter(Boolean).slice(0, 20)
      : undefined;
    const result = await this.callsService.list(
      {
        direction,
        status,
        agentId,
        number,
        numbers: parsedNumbers,
        dateFrom,
        dateTo,
        origin,
      },
      cursor,
      parsedLimit,
    );
    return {
      success: true,
      data: maskCalls(
        await this.withNames(result.items),
        await this.maySeeNumbers(user),
      ),
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('by-party/:kind/:id')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: "Calls with one client, company or teammate",
    description:
      '**Guard:** `calls.view` permission required. Indexed lookup (PartyIndex) ' +
      'rather than a filtered scan of the whole log. Covers calls whose ' +
      'association has been frozen — older records fall back to the `numbers` ' +
      'filter on `GET /calls` until they are read once.',
  })
  async byParty(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @CurrentUser() user?: JwtUser,
  ) {
    if (!['contact', 'company', 'user'].includes(kind)) {
      throw new BadRequestException('kind must be contact, company or user');
    }
    const parsedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const result = await this.callsService.listByParty(
      kind,
      id,
      parsedLimit,
      cursor,
    );
    return {
      success: true,
      data: maskCalls(
        await this.withNames(result.items),
        await this.maySeeNumbers(user),
      ),
      pagination: { nextCursor: result.nextCursor, count: result.items.length },
    };
  }

  @Get('active')
  @ApiOperation({
    summary: "The call you are on right now",
    description:
      'Any authenticated user. The browser knows its own Twilio leg, but on an ' +
      'inbound call that leg is a child of the record — so the server is the ' +
      'one that can say which call you are actually on. Returns null when you ' +
      'are not on a call.',
  })
  async active(@CurrentUser() user: JwtUser) {
    const call = await this.callsService.activeCallFor(user.id);
    if (!call) return { success: true, data: null };
    const [enriched] = await this.withNames([call]);
    // Ungated route, polled every 5s by the softphone widget — the one a masked
    // technician hits most, and the guard never resolved anything for it.
    return {
      success: true,
      data: maskCall(enriched, await this.maySeeNumbers(user)),
    };
  }

  @Get('identify')
  @ApiOperation({
    summary: 'Who does this number belong to?',
    description:
      'Any authenticated user — the softphone calls this when it rings, and a ' +
      'technician who may not read the call log still needs to know who is ' +
      'calling. Resolves through the same precedence as the call log: one of ' +
      'our own people on their personal number first, then a CRM contact, ' +
      'then a company main line.',
  })
  async identify(@Query('phone') phone?: string) {
    if (!phone) throw new BadRequestException('phone is required');
    const [personals, contacts] = await Promise.all([
      this.userPhones.resolve([phone]),
      this.contacts.resolve([phone]),
    ]);
    return {
      success: true,
      data: identifyNumber(phone, { personals, contacts }) ?? null,
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
  async live(@CurrentUser() user?: JwtUser) {
    const data = await this.callsService.listLive();
    return {
      success: true,
      data: maskCalls(await this.withNames(data), await this.maySeeNumbers(user)),
    };
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
  stream(@Res() res: Response, @CurrentUser() user?: JwtUser): void {
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
      //
      // The grant is resolved PER EVENT rather than once at connect: an SSE
      // connection outlives a permission change by hours, and the lookup is
      // memoised for 60s, so this costs one Redis read a minute per viewer and
      // caps how long a revoked viewer keeps receiving numbers.
      void Promise.all([this.withNames([event.call]), this.maySeeNumbers(user)])
        .then(([[call], allowed]) =>
          res.write(
            `data: ${JSON.stringify({ ...event, call: maskCall(call, allowed) })}\n\n`,
          ),
        )
        // A failed lookup must not fall through to the unmasked event.
        .catch(() =>
          res.write(
            `data: ${JSON.stringify({ ...event, call: maskCall(event.call as never, false) })}\n\n`,
          ),
        );
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
    // Previously returned RAW records straight from the GSI — no enrichment and
    // no redaction, on a route documented as "any authenticated user".
    return {
      success: true,
      data: maskCalls(await this.withNames(data), await this.maySeeNumbers(user)),
    };
  }

  @Get(':sid')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'A single call record',
    description: '**Guard:** `calls.view` permission required.',
  })
  async detail(@Param('sid') sid: string, @CurrentUser() user?: JwtUser) {
    const data = await this.callsService.getBySid(sid);
    if (!data) throw new NotFoundException('Call not found');
    const [enriched] = await this.withNames([data]);
    return {
      success: true,
      data: maskCall(enriched, await this.maySeeNumbers(user)),
    };
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

  @Post(':sid/participants')
  @ApiOperation({
    summary: 'Bring a teammate onto the call, or hand it over',
    description:
      'Any authenticated user on the call. Adds a teammate as a conference ' +
      'participant, reachable on their softphone or the personal number on ' +
      'their profile. With `handOver: true` the caller is released first, so ' +
      'they can hang up without ending the call — that is a transfer. ' +
      'Without it, everyone stays on: that is Add.',
  })
  async addParticipant(
    @Param('sid') sid: string,
    @Body() dto: AddParticipantDto,
    @CurrentUser() user: JwtUser,
  ) {
    const call = await this.callsService.getBySid(sid);
    if (!call) throw new NotFoundException('Call not found');
    if (!call.status || !LIVE_STATUSES.includes(call.status)) {
      throw new ConflictException('This call is not live');
    }
    if (dto.channel !== 'softphone' && dto.channel !== 'personal') {
      throw new BadRequestException('channel must be "softphone" or "personal"');
    }

    const target = await this.directory.find(dto.userId);
    if (!target) throw new NotFoundException('No such teammate');

    const result = await this.conferenceService.addParticipant(
      sid,
      { userId: target.id, channel: dto.channel, phone: target.phone },
      user.id,
    );

    // A hand-over releases the transferring agent's leg up front: their leg
    // was created to end the conference on exit, which is right until the
    // moment they hand the call to somebody else — and the person taking the
    // call inherits that, or nobody's hang-up would end it.
    if (dto.handOver) {
      await this.conferenceService.releaseAgentLeg(sid, user.id);
      await this.conferenceService.promoteLeg(sid, result.callSid);
    }

    return {
      success: true,
      data: { callSid: result.callSid, handOver: !!dto.handOver },
    };
  }

  @Delete(':sid/participants/:legSid')
  @ApiOperation({
    summary: 'Drop someone from a live call',
    description:
      'Any authenticated user on the call. Removes that leg; the call carries ' +
      'on for everyone else.',
  })
  async removeParticipant(
    @Param('sid') sid: string,
    @Param('legSid') legSid: string,
  ) {
    await this.conferenceService.removeParticipant(sid, legSid);
    return { success: true, data: null };
  }

  @Put(':sid/party')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'Correct who a call was with',
    description:
      '**Guard:** `calls.view` permission required. Overwrites what automatic ' +
      'matching decided and marks the record as set by a person, so it is ' +
      'never re-derived. Pass `kind: null` to clear that side.',
  })
  async setParty(
    @Param('sid') sid: string,
    @Body() dto: SetPartyDto,
    @CurrentUser() user: JwtUser,
  ) {
    const call = await this.callsService.getBySid(sid);
    if (!call) throw new NotFoundException('Call not found');
    if (dto.side !== 'from' && dto.side !== 'to') {
      throw new BadRequestException('side must be "from" or "to"');
    }

    const current = storedParties(call);
    const next = {
      from: partyStorage(current.from),
      to: partyStorage(current.to),
    };
    next[dto.side] = dto.kind
      ? { kind: dto.kind, id: dto.id }
      : undefined;

    await this.callsService.setPartiesManually(sid, next, call.startedAt);
    this.logger.log(`Call ${sid}: ${dto.side} party set manually by ${user.id}`);

    const updated = await this.callsService.getBySid(sid);
    const [enriched] = await this.withNames([updated as CallRecord]);
    return {
      success: true,
      data: maskCall(enriched, await this.maySeeNumbers(user)),
    };
  }

  @Put(':sid/deal')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'Attach this call to a job, or detach it',
    description:
      '**Guard:** `calls.view` permission required. A job collects many calls, ' +
      'so linking is a plain overwrite. The job’s activity feed gets an entry ' +
      'either way, best-effort — the link lives on the call record.',
  })
  async setDeal(
    @Param('sid') sid: string,
    @Body() dto: SetDealDto,
    @CurrentUser() user: JwtUser,
  ) {
    const updated = await this.callsService.linkDeal(
      sid,
      dto.dealId ?? null,
      { id: user.id },
    );
    if (!updated) throw new NotFoundException('Call not found');
    const [enriched] = await this.withNames([updated]);
    return {
      success: true,
      data: maskCall(enriched, await this.maySeeNumbers(user)),
    };
  }

  @Post(':sid/take')
  @ApiOperation({
    summary: 'Take a call you are already on into this browser tab',
    description:
      'Any authenticated user, for a call they are already on — no extra ' +
      'permission, because moving your own audio between your own tabs is not ' +
      'a privilege. Issues the same single-use grant as monitor/join and ' +
      'reports which legs are currently yours; the browser joins the ' +
      'conference and then calls `/take/complete`, which drops the old legs. ' +
      'Joining before dropping is what keeps the customer from hearing hold ' +
      'music mid-handover.',
  })
  async take(@Param('sid') sid: string, @CurrentUser() user: JwtUser) {
    const call = await this.mustBeMyLiveCall(sid, user.id);
    const previousLegs = await this.conferenceService.legsOf(sid, user.id);
    await this.conferenceService.grantMonitor(user.id, call.conferenceName!, 'join');
    return {
      success: true,
      data: { conferenceName: call.conferenceName, previousLegs },
    };
  }

  @Post(':sid/take/complete')
  @ApiOperation({
    summary: 'Finish a tab hand-over: drop the legs the call came from',
    description:
      'Called once the new tab is actually in the conference. Removes the ' +
      'legs listed by `/take` and promotes whatever leg is left, so hanging ' +
      'up in the new tab ends the call as it would have in the old one.',
  })
  async takeComplete(
    @Param('sid') sid: string,
    @Body() dto: TakeCompleteDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this.mustBeMyLiveCall(sid, user.id);
    const previous = new Set(dto.previousLegs ?? []);

    // The new leg has to be in the conference before the old one goes. The
    // browser resolving `device.connect()` only means a call was created — if
    // its TwiML then refused the join, completing anyway would remove the only
    // leg we had and leave the customer alone on the line.
    //
    // Retried because a leg takes a moment to show up in the participant list
    // after it joins; refusing on the first empty read would fail hand-overs
    // that are actually fine.
    let arrived: string[] = [];
    for (let attempt = 0; attempt < 4 && arrived.length === 0; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
      const legs = await this.conferenceService.legsOf(sid, user.id);
      arrived = legs.filter((legSid) => !previous.has(legSid));
    }
    if (arrived.length === 0) {
      throw new ConflictException(
        'The call did not move — this tab never joined it, so the original ' +
          'tab still has it',
      );
    }

    for (const legSid of previous) {
      // Released first: a leg removed while it still owns the conference
      // lifecycle would take the customer down with it.
      await this.conferenceService.releaseLeg(sid, legSid);
      await this.conferenceService.removeParticipant(sid, legSid);
    }

    for (const legSid of arrived) {
      await this.conferenceService.promoteLeg(sid, legSid);
    }

    return { success: true, data: { sid, movedTo: arrived } };
  }

  /**
   * A call the caller is genuinely on, and still live. Authorising by "is this
   * yours" rather than by permission: a technician with no supervision rights
   * still gets to move their own call to the tab in front of them.
   */
  private async mustBeMyLiveCall(sid: string, userId: string) {
    const mine = await this.callsService.activeCallFor(userId);
    if (!mine || mine.callSid !== sid) {
      throw new ForbiddenException('You are not on this call');
    }
    if (!mine.conferenceName) {
      throw new ConflictException('This call has no conference to join');
    }
    return mine;
  }

  /* ------------------------------------------------------------ bridge */

  @Post('bridge')
  @ApiOperation({
    summary: 'Place a masked call to a job\'s client',
    description:
      'Any authenticated user; a technician must additionally be on the job ' +
      "roster. The body carries a HANDLE — {dealId, contactId, phoneIndex} — " +
      'never a phone number: the client\'s number is resolved server-side and ' +
      'never reaches the browser. `via` picks which end rings the caller ' +
      '(`cell` rings their handset, then dials the client; `softphone` opens ' +
      'a browser leg); omitted, presence decides. Returns immediately with a ' +
      'bridgeId; watch GET /calls/active for progress.',
  })
  async startBridge(
    @Body() dto: StartBridgeDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (!dto?.dealId || !dto?.contactId) {
      throw new BadRequestException('dealId and contactId are required');
    }
    if (dto.via && dto.via !== 'cell' && dto.via !== 'softphone') {
      throw new BadRequestException('via must be "cell" or "softphone"');
    }

    const prepared = await this.bridge.prepare(user, {
      dealId: dto.dealId,
      contactId: dto.contactId,
      phoneIndex: dto.phoneIndex,
    });

    // Asked for explicitly, that is the answer. Otherwise: a technician at a
    // browser takes their own leg through the softphone — cheaper per minute,
    // and no carrier voicemail to defend against — and anyone else gets their
    // handset rung.
    let mode = dto.via;
    if (!mode) {
      const online = await this.presence
        .listOnline()
        .catch(() => [] as string[]);
      mode = online.includes(user.id) ? 'softphone' : 'cell';
    }

    if (mode === 'softphone') {
      return {
        success: true,
        data: {
          bridgeId: prepared.bridgeId,
          mode,
          clientName: prepared.clientName,
        },
      };
    }

    const callSid = await this.ringTechnician(prepared.bridgeId, user);
    return {
      success: true,
      data: {
        bridgeId: prepared.bridgeId,
        mode,
        callSid,
        clientName: prepared.clientName,
      },
    };
  }

  @Delete('bridge/:bridgeId')
  @ApiOperation({
    summary: 'Cancel a bridge that is still ringing',
    description:
      'The creator or the technician being rung. A mis-tap must be abortable ' +
      'before the client is ever dialled.',
  })
  async cancelBridge(
    @Param('bridgeId') bridgeId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const ctx = await this.bridge.context(bridgeId);
    if (!ctx) return { success: true, data: { cancelled: false } };
    if (ctx.technicianId !== user.id && ctx.actorId !== user.id) {
      throw new ForbiddenException('That is not your call');
    }

    const legSid = await this.bridge.answerClaim(bridgeId);
    if (legSid) await this.cancelLeg(legSid);
    await this.bridge.release(ctx.technicianId, bridgeId);
    return { success: true, data: { cancelled: true } };
  }

  /**
   * Ring the technician's own handset, and open the call record immediately.
   *
   * The record is opened HERE rather than in the status callback: a leg that
   * rings and is never answered would otherwise produce a party-less orphan —
   * no from, no to, no agentId — that every read path and display helper has
   * to survive. Opening it up front also means the call shows up in the live
   * list while it is still ringing, which is what the caller is watching.
   */
  private async ringTechnician(
    bridgeId: string,
    user: JwtUser,
  ): Promise<string | undefined> {
    const ctx = await this.bridge.context(bridgeId);
    if (!ctx) throw new NotFoundException('That call is no longer available');

    const phone = await this.directory
      .find(ctx.technicianId)
      .then((u) => u?.phone)
      .catch(() => undefined);
    if (!phone) {
      await this.bridge.release(ctx.technicianId, bridgeId);
      throw new ConflictException(
        'No phone number on file for you — add one in your profile, or turn the softphone on',
      );
    }

    const base = this.config.publicBaseUrl;
    try {
      const created = await new TwilioRest(this.config).run((c) =>
        c.calls.create({
          to: phone,
          from: ctx.from,
          url: `${base}/api/telephony/voice/bridge-join?b=${encodeURIComponent(bridgeId)}&whisper=1`,
          method: 'POST',
          // Twilio adds up to a 5s buffer, so the effective ring is ~20s. The
          // whisper gather is the real voicemail defence, not this.
          timeout: BRIDGE_RING_SECONDS,
          statusCallback: `${base}/api/telephony/voice/status?bridge=${encodeURIComponent(bridgeId)}`,
          statusCallbackMethod: 'POST',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        }),
      );

      await this.callsService.applyLifecycle({
        callSid: created.sid,
        direction: 'outbound',
        from: ctx.from,
        to: ctx.to,
        status: 'initiated',
        agentId: ctx.technicianId,
        origin: 'bridge',
        callerIdSource: ctx.callerIdSource as never,
      });
      return created.sid;
    } catch (error) {
      await this.bridge.release(ctx.technicianId, bridgeId);
      throw error;
    }
  }

  /**
   * Cancel a leg that has not been answered.
   *
   * `canceled`, not `completed`: Twilio defines canceled as "cancelled via the
   * REST API while it was ringing", and completed as "answered and ended".
   * 21220 means it was answered in the meantime, so fall back to completed.
   */
  private async cancelLeg(sid: string): Promise<void> {
    const rest = new TwilioRest(this.config);
    try {
      await rest.run((c) => c.calls(sid).update({ status: 'canceled' }));
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code === 21220) {
        await rest
          .run((c) => c.calls(sid).update({ status: 'completed' }))
          .catch(() => undefined);
        return;
      }
      this.logger.warn(`Could not cancel leg ${sid}: ${String(error)}`);
    }
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
