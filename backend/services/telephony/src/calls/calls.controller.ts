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
  Patch,
  Post,
  Put,
  Query,
  Res, Optional,
  Req,
  Headers,
} from '@nestjs/common';
import { type Response } from 'express';
import { Readable } from 'stream';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser, hasPermission, RequirePermission, S3Service } from '@bitcrm/shared';
import { type CallsDashboardBundle, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { Inject } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallEventsBus } from './call-events.bus';
import {
  LIVE_STATUSES,
  type CallRecord,
  type CallStatus,
  type ListCallsFilter,
} from './calls.repository';
import { callsFilterFromQuery, type CallsQueryParams } from './call-query';
import { CallsExportService } from './calls-export.service';
import { ConferenceService, type MonitorMode } from '../voice/conference.service';
import { UserNamesService } from '../common/user-names.service';
import {
  identifyNumber,
  partyStorage,
  storedParties,
  type EnrichedCall,
} from './party-resolver';
import { CallNamer, withoutStoredExtras } from './call-namer';
import { RecentCallsStore } from './recent-calls.store';
import { ContactLookupService } from '../common/contact-lookup.service';
import { UserPhoneLookupService } from '../common/user-phone-lookup.service';
import { UserDirectoryService } from '../common/user-directory.service';
import { PermissionLookupService } from '../common/permission-lookup.service';
import { BridgeService } from '../common/bridge.service';
import { technicianLegProgress } from '../common/bridge-progress';
import { PresenceService } from '../presence/presence.service';
import { TwilioRest } from '@bitcrm/shared';
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

/** The body of PATCH /calls/:sid/tags — a delta, so two tabs never fight. */
class UpdateCallTagsDto {
  /** Call-tag catalog ids to put on the call. */
  add?: string[];
  /** Call-tag catalog ids to take off it. */
  remove?: string[];
}

/** Rows on the dashboard's "Recent Calls" — Workiz shows four. */
const DASHBOARD_RECENT_CALLS = 4;

/** Lifetime of a presigned recording URL: long enough to start playing, short enough not to share. */
const RECORDING_URL_SECONDS = 300;

/**
 * Answer a whole object from memory, or the one `Range` it asks for (206) —
 * what lets a player seek. Only `bytes=a-b`, `bytes=a-` and `bytes=-n`; a
 * range past the end is 416, anything unparseable is ignored (whole object).
 */
function sendBuffer(res: Response, body: Buffer, contentType: string, range?: string): void {
  const size = body.length;
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start: number;
    let end: number;
    if (!m[1]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    }
    if (start >= size || start > end) {
      res.status(416);
      res.set({ 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
      res.end();
      return;
    }
    res.status(206);
    res.set({
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    });
    res.end(body.subarray(start, end + 1));
    return;
  }
  res.set({ 'Content-Type': contentType, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' });
  res.end(body);
}

/** The filters the list, its count, the cards and the export share (docs). */
const CALL_FILTERS_HELP =
  'every list param takes one value or a comma list (any of them): `direction`; `status` (our statuses ' +
  'and/or Workiz’s `answered`, `missed`, `active`, `voicemail`); `agentId`; `tagId` (call tags — a filter ' +
  'inside the date-ordered walk, so pair it with dateFrom/dateTo); `flowId`; `sourceId` (Workiz ad group). ' +
  'Also `number` (substring), `numbers` (a client’s phone list, matches any), `dateFrom`/`dateTo` (ISO ' +
  'instants or prefixes), `origin`, `minDuration`/`maxDuration` (whole seconds, inclusive; a call with no ' +
  'talk time counts as 0), `masked` and `hasJob` (true/false).';

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
    // Optional: only imported calls keep their audio here, and a service
    // without storage configured must still boot.
    @Optional() private readonly s3?: S3Service,
    @Optional() private readonly exporter?: CallsExportService,
    /** The dashboard's "Recent Calls", kept in Redis by CallFinalizer. */
    @Optional() private readonly recentCalls?: RecentCallsStore,
  ) {
    this.namer = new CallNamer(userNames, contacts, userPhones);
  }

  private readonly namer: CallNamer;

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

  /**
   * Name both sides of every call (CallNamer — batched, best-effort lookups).
   * Read-only: freezing the parties and stamping the search names happen once
   * on the write path, when the call ends (CallFinalizer), never here.
   */
  private async withNames(records: CallRecord[]): Promise<EnrichedCall[]> {
    return (await this.namer.name(records)).map((n) => n.call);
  }

  /* NOTE: static routes are declared before ':sid' so they aren't swallowed. */

  /**
   * The log's filters off the query string — one parse for the list, its
   * count, the cards and the export, so all four describe the same calls.
   */
  private async filterFor(query: CallsQueryParams | undefined, user: JwtUser | undefined): Promise<ListCallsFilter> {
    return callsFilterFromQuery(query ?? {}, { numbers: await this.maySeeNumbers(user) });
  }

  @Get()
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'List all calls (global log)',
    description:
      '**Guard:** `calls.view` permission required. Newest first; cursor ' +
      `pagination; filters: ${CALL_FILTERS_HELP} ` +
      'The walk is bounded per request, so a filtered page can come back ' +
      'short — even empty — while still carrying `nextCursor`: that means ' +
      '"nothing more in the stretch read so far", not "no more calls". A ' +
      'page is the last one only when `nextCursor` is absent. ' +
      'Parties are named on the way out: system users from user-service, ' +
      'outside callers from CRM contacts. Each row carries its `tagIds`.',
  })
  async list(@Query() query: CallsQueryParams = {}, @CurrentUser() user?: JwtUser) {
    // Query DTOs aren't transformed in this codebase — coerce in-service.
    const parsedLimit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
    const result = await this.callsService.list(
      await this.filterFor(query, user),
      query.cursor,
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

  @Get('count')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'How many calls the filter selects',
    description:
      '**Guard:** `calls.view` permission required. Takes the same filters as the list ' +
      '(`cursor` and `limit` are ignored) and answers `{ total, atLeast }` — the row ' +
      'count behind "Page 2 of 7". The log reaches back years, so the walk is bounded: ' +
      '`atLeast` means it stopped on that budget and the real number is higher, which the ' +
      'panel renders as `7+`. Narrow with `dateFrom`/`dateTo` for an exact one. ' +
      'Cached for thirty seconds.',
  })
  async count(@Query() query: CallsQueryParams = {}, @CurrentUser() user?: JwtUser) {
    const data = await this.callsService.count(await this.filterFor(query, user));
    return { success: true, data };
  }

  @Get('stats/summary')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'The stat cards over the call log — Workiz’s MISSED CALLS, CALLS (N callers), REVENUE',
    description:
      '**Guard:** `calls.view`; `revenue` only with `financials.view`. Takes the list’s filters ' +
      '(`cursor` and `limit` are ignored) and answers `{ calls, callers, missed, active, jobs, revenue?, atLeast }`: ' +
      '`calls` = the rows the filter selects (the count’s walk, so it equals `/calls/count`); `callers` = distinct ' +
      'outside numbers (inbound `from`, outbound `to`); `missed` = inbound calls missed by the Call Tracking rule; ' +
      '`active` = calls still live; `jobs` = distinct linked jobs (Workiz job ids included); `revenue` = Σ the ' +
      'linked deals’ totals — absent without `financials.view`, or when deal-service cannot say. `atLeast`: the ' +
      'walk stopped on its read budget and every number is a floor. Cached for thirty seconds.',
  })
  async summary(
    @Query() query: CallsQueryParams = {},
    @CurrentUser() user: JwtUser | undefined,
    // PermissionGuard has already resolved the caller's grants for this route.
    @Req() req: { resolvedPermissions?: ResolvedPermissions },
  ) {
    const withRevenue = hasPermission(req?.resolvedPermissions, 'financials', 'view');
    const data = await this.callsService.summary(await this.filterFor(query, user), { withRevenue });
    if (!withRevenue) delete data.revenue;
    return { success: true, data };
  }

  // Declared before ':sid' — one segment, so the param route would take it.
  @Get('export.csv')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'The call log as CSV — Workiz’s "Export"',
    description:
      '**Guard:** `calls.view` (the permission matrix has no separate export action — the other CSV exports ' +
      'are guarded by their view grant too). Takes the list’s filters (`cursor` and `limit` are ignored) and ' +
      'streams `text/csv` with Workiz’s columns: Status, From, To, Time, Call Flow, Ad Source, Tags, ' +
      'Answered By, Jobs & Leads, Revenue — newest first, every row of the selection up to 100 000. Revenue is ' +
      'dropped without `financials.view`, the numbers without `contacts.view_numbers`; job numbers are read ' +
      'as the viewer (`deals.view`). Time is Workiz’s "Thu Oct 8th, 3:15PM" on the account clock.',
  })
  async exportCsv(
    @Query() query: CallsQueryParams = {},
    @CurrentUser() user: JwtUser | undefined,
    @Req() req: { resolvedPermissions?: ResolvedPermissions },
    @Res() res: Response,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    if (!this.exporter) throw new HttpException('Export unavailable', 503);
    const filter = await this.filterFor(query, user);
    const maySeeNumbers = await this.maySeeNumbers(user);
    const day = (v?: string) => (v ?? '').slice(0, 10);
    const name = `calls-${day(filter.dateFrom)}_${day(filter.dateTo)}.csv`.replace(/[^\w.-]/g, '');

    let started = false;
    const sink = {
      write: (chunk: string): Promise<void> => {
        if (!started) {
          started = true;
          res.status(200);
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
          res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
        }
        return new Promise((resolve) => {
          if (res.write(chunk)) resolve();
          else res.once('drain', () => resolve());
        });
      },
    };
    try {
      await this.exporter.stream(
        filter,
        {
          money: hasPermission(req?.resolvedPermissions, 'financials', 'view'),
          maySeeNumbers,
          authorization,
          name: (records) => this.withNames(records),
        },
        sink,
      );
      res.end();
    } catch (err) {
      // Before the first byte this is an ordinary error response.
      if (!started) throw err;
      this.logger.error(`Calls export failed mid-stream: ${(err as Error).message}`);
      res.destroy(err as Error);
    }
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
            `data: ${JSON.stringify({ ...event, call: maskCall(withoutStoredExtras(event.call) as never, false) })}\n\n`,
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

  @Get('stats/top-flows')
  // The widget's own grant, not `calls.view`: hiding a dashboard widget from
  // a role has to mean its endpoint refuses that role (US-03-03).
  @RequirePermission('dashboard', 'view_top_call_flows')
  @ApiOperation({
    summary: '"Top Call Flows" — calls per call flow per day',
    description:
      '**Guard:** `dashboard.view_top_call_flows`. `from`..`to` are whole days (YYYY-MM-DD, inclusive, at ' +
      'most 92). Every day of the window is present, zeros included; the eight busiest flows come back, ' +
      'busiest first. Only calls that entered a flow count — outbound calls never do. `atLeast` means the ' +
      'walk stopped on its read budget. Served from a snapshot built nightly at 3 AM Eastern and kept ' +
      'until the next (`computedAt`); `refresh=1` rebuilds it.',
  })
  async topFlows(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('refresh') refresh?: string,
  ) {
    const fresh = refresh === '1' || refresh === 'true';
    return { success: true, data: await this.callsService.topFlows({ from, to }, { fresh }) };
  }

  @Get('stats/dashboard')
  @RequirePermission('dashboard', 'view')
  @ApiOperation({
    summary: 'The call widgets the caller may see, in one answer',
    description:
      '**Guard:** `dashboard.view`, and then **each widget\'s own grant** inside — ' +
      '`dashboard.view_top_call_flows` for `topCallFlows`, `dashboard.view_recent_calls` for ' +
      '`recentCalls`; a widget the role does not hold is absent. `from`..`to` is the opening window. ' +
      'What the dashboard loads first, so its cards paint together.',
  })
  async dashboardBundle(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: JwtUser,
    // PermissionGuard has already resolved the caller's grants for this route.
    @Req() req: { resolvedPermissions?: ResolvedPermissions },
  ) {
    const may = (action: string) => hasPermission(req.resolvedPermissions, 'dashboard', action);
    const data: CallsDashboardBundle = {};
    const [flows, recent] = await Promise.all([
      may('view_top_call_flows') ? this.callsService.topFlows({ from, to }) : undefined,
      may('view_recent_calls') ? this.recentForDashboard(user) : undefined,
    ]);
    if (flows) data.topCallFlows = flows;
    if (recent) data.recentCalls = recent.data;
    return { success: true, data };
  }

  @Get('stats/recent')
  @RequirePermission('dashboard', 'view_recent_calls')
  @ApiOperation({
    summary: '"Recent Calls" — the four most recent finished calls',
    description:
      '**Guard:** `dashboard.view_recent_calls`. The newest four of the last twenty finished calls, kept in ' +
      'Redis as each call ends and named then; until that list holds four (just after a deploy) the global ' +
      'log\'s first four rows. Client numbers are masked without `contacts.view_numbers`, as in the log.',
  })
  async recentForDashboard(@CurrentUser() user: JwtUser) {
    // The last finished calls, named when they ended (Redis, CallFinalizer).
    // Until it holds a full widget's worth — just after a deploy — the log.
    const cached = (await this.recentCalls?.read(DASHBOARD_RECENT_CALLS)) ?? [];
    const named =
      cached.length >= DASHBOARD_RECENT_CALLS
        ? cached.map((c) => withoutStoredExtras(c) as EnrichedCall)
        : await this.withNames(
            (await this.callsService.list({}, undefined, DASHBOARD_RECENT_CALLS)).items,
          );
    return {
      success: true,
      data: maskCalls(named, await this.maySeeNumbers(user)),
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

  @Get(':sid/recording/url')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: "A short-lived URL to a call's recording in our bucket",
    description:
      '**Guard:** `calls.view` permission required. `{ url, expiresIn }` — a presigned S3 GET (five minutes) ' +
      'that an `<audio>` element can stream and seek directly (S3 answers Range requests with the stored ' +
      'content type). Only for recordings in our bucket: imported calls, and Twilio recordings once copied ' +
      'after the recording-status webhook. 404 otherwise — play `GET /calls/:sid/recording` instead.',
  })
  async recordingUrl(@Param('sid') sid: string) {
    const call = await this.callsService.getBySid(sid);
    if (!call?.recordingKey || !this.s3) throw new NotFoundException('No recording in storage for this call');
    const url = await this.s3.getPresignedDownloadUrl(call.recordingKey, { expiresIn: RECORDING_URL_SECONDS });
    return { success: true, data: { url, expiresIn: RECORDING_URL_SECONDS } };
  }

  @Get(':sid/recording')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: "A call's recording",
    description:
      '**Guard:** `calls.view` permission required. A recording in our bucket (imported, or a Twilio ' +
      'recording copied after its webhook) is served from S3 — with `Range` support (206), or with ' +
      '`redirect=1` as a 302 to a five-minute presigned URL. A Twilio recording not copied yet is proxied ' +
      'from Twilio with server-side auth. NOTE: a cross-origin `fetch` cannot follow the 302 (the redirected ' +
      'request carries `Origin: null`, which the bucket\'s CORS rule does not allow) — such a client uses ' +
      '`GET /calls/:sid/recording/url` and plays the URL itself.',
  })
  async recording(
    @Param('sid') sid: string,
    @Res() res: Response,
    @Query('redirect') redirect?: string,
    @Headers('range') range?: string,
  ) {
    const call = await this.callsService.getBySid(sid);

    // In our bucket: an imported Workiz call's audio (Twilio never had it),
    // or a Twilio recording RecordingArchiveService has copied.
    if (call?.recordingKey && this.s3) {
      if (redirect === '1' || redirect === 'true') {
        const url = await this.s3.getPresignedDownloadUrl(call.recordingKey, { expiresIn: RECORDING_URL_SECONDS });
        res.redirect(302, url);
        return;
      }
      const object = await this.s3.getObjectBuffer(call.recordingKey);
      if (!object) throw new NotFoundException('No recording for this call');
      sendBuffer(res, object.body, object.contentType ?? 'audio/wav', range);
      return;
    }
    if (call?.recordingKey) throw new NotFoundException('No recording for this call');

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

  @Patch(':sid/tags')
  @RequirePermission('calls', 'view')
  @ApiOperation({
    summary: 'Tag a call, or take tags off it',
    description:
      '**Guard:** `calls.view` permission required — the same grant that ' +
      'links a call to a job. Body `{ add?: string[], remove?: string[] }` ' +
      'of call-tag ids (see /call-tags). A delta rather than the whole list, ' +
      'so two people tagging one call never overwrite each other; the write ' +
      'is a compare-and-set on the stored list. 404 for an unknown call or ' +
      'an unknown tag being added; 400 for an archived tag being added, an ' +
      'empty change, or more than 25 tags. Returns the call as persisted, ' +
      'named and masked like the list.',
  })
  async updateTags(
    @Param('sid') sid: string,
    @Body() dto: UpdateCallTagsDto,
    @CurrentUser() user: JwtUser,
  ) {
    const updated = await this.callsService.updateTags(
      sid,
      { add: dto?.add, remove: dto?.remove },
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
      'bridgeId; a `cell` bridge reports its progress on ' +
      'GET /calls/bridge/:bridgeId.',
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

  @Get('bridge/:bridgeId')
  @ApiOperation({
    summary: 'Where a masked call stands',
    description:
      '**Guard:** Authenticated (any role), exactly like `POST /calls/bridge` — and ' +
      'only for the user who started the bridge: anyone else gets 404, as does an ' +
      'unknown or expired id, so a bridge id cannot be probed. Returns ' +
      '`{state, reason?}`. `state` moves `ringing_you` → `you_answered` → ' +
      '`connecting_client` → `connected` → `ended`, or stops at `failed` with a ' +
      '`reason` to show as is ("Your phone did not answer", "Your number could not ' +
      'be reached from the company line", "The client\'s line is busy", …), read ' +
      'off both legs\' Twilio status callbacks (CallStatus, SipResponseCode, ' +
      'ErrorCode). Kept 5 minutes after the last change. The phone polls it every ' +
      '2 s after a `cell` bridge.',
  })
  async bridgeStatus(
    @Param('bridgeId') bridgeId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const progress = await this.bridge.statusFor(bridgeId, user.id);
    if (!progress) throw new NotFoundException('Call not found');
    return { success: true, data: progress };
  }

  @Delete('bridge/:bridgeId')
  @ApiOperation({
    summary: 'Cancel a bridge that is still ringing',
    description:
      'The creator or the technician being rung. Hangs up the technician\'s ' +
      'leg while it rings: a mis-tap must be abortable before the client is ' +
      'ever dialled.',
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

    // The answer claim names the leg only once a key was pressed; while the
    // handset still rings, the leg is the one ringTechnician placed.
    const legSid =
      (await this.bridge.answerClaim(bridgeId)) ??
      (await this.bridge.ringingLeg(bridgeId));
    if (legSid) await this.cancelLeg(legSid);
    await this.bridge.release(ctx.technicianId, bridgeId);
    await this.bridge.advance(bridgeId, () => ({ state: 'ended' }));
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
      // Before the leg exists: Twilio can report a leg it refused before
      // calls.create has returned, and that `failed` needs somewhere to land.
      await this.bridge.track(bridgeId, ctx.actorId);
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
      await this.bridge.rememberLeg(bridgeId, created.sid);

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
      // Nobody will poll a bridge whose POST failed; this only keeps the
      // record from saying "ringing" for a phone that never rang.
      await this.bridge
        .advance(bridgeId, (current) =>
          technicianLegProgress({ CallStatus: 'failed' }, current),
        )
        .catch(() => undefined);
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
