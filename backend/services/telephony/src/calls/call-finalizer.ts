import { Injectable, Logger, Optional } from '@nestjs/common';
import { CallsRepository, LIVE_STATUSES } from './calls.repository';
import { CallNamer } from './call-namer';
import { RecentCallsStore } from './recent-calls.store';
import { UserNamesService } from '../common/user-names.service';
import { ContactLookupService } from '../common/contact-lookup.service';
import { UserPhoneLookupService } from '../common/user-phone-lookup.service';

/** How long after the terminal status a call is finalized. */
const FINALIZE_DELAY_MS = 5_000;

/**
 * What happens once, on the write path, when a call ends — work the log's
 * read path used to do as a side effect of every `GET /calls`:
 *
 * - freeze who each side was (`setParties`, one-shot and conditional);
 * - stamp both sides' folded names for the Search box (`setPartyNames`);
 * - push the named call onto the dashboard's "Recent Calls" list (Redis).
 *
 * Scheduled fire-and-forget by CallsService on the first terminal status;
 * nothing here can fail a webhook. A call the lookups could not name (a
 * service blinking at that moment) keeps its numbers until
 * `backfill:call-party-names` or a manual party change.
 */
@Injectable()
export class CallFinalizer {
  private readonly logger = new Logger(CallFinalizer.name);
  private readonly namer: CallNamer;

  constructor(
    private readonly repo: CallsRepository,
    @Optional() userNames?: UserNamesService,
    @Optional() contacts?: ContactLookupService,
    @Optional() userPhones?: UserPhoneLookupService,
    @Optional() private readonly recent?: RecentCallsStore,
  ) {
    this.namer = new CallNamer(userNames, contacts, userPhones);
  }

  /**
   * Finalize in the background, a few seconds after the terminal status —
   * the conference-end handler and the last participant writes land around
   * the same moment, and an automatic freeze is permanent, so it reads the
   * settled record (the read path used to freeze on the first read after the
   * call, which was never instant either). Never throws; a task stopping in
   * that window just leaves the call unfrozen (named by number on read).
   */
  schedule(callSid: string, delayMs = FINALIZE_DELAY_MS): void {
    const run = () =>
      void this.finalize(callSid).catch((err) =>
        this.logger.warn(`Finalizing ${callSid} failed: ${err instanceof Error ? err.message : err}`),
      );
    if (delayMs <= 0) {
      run();
      return;
    }
    setTimeout(run, delayMs).unref?.();
  }

  async finalize(callSid: string): Promise<void> {
    const call = await this.repo.getBySid(callSid);
    if (!call || call.internalLegOf) return;
    if (call.status && LIVE_STATUSES.includes(call.status)) return;

    const [named] = await this.namer.name([call]);
    if (named.freeze) {
      await this.repo.setParties(callSid, named.freeze, call.startedAt, 'auto');
    }
    if (named.searchText !== undefined && named.searchText !== (call.partyNames ?? '')) {
      await this.repo.setPartyNames(callSid, named.searchText);
    }
    await this.recent?.push(named.call);
  }

  /** After a person changed who a call was with: rewrite its search names. */
  async restampNames(callSid: string): Promise<void> {
    const call = await this.repo.getBySid(callSid);
    if (!call) return;
    const [named] = await this.namer.name([call]);
    if (named.searchText !== undefined && named.searchText !== (call.partyNames ?? '')) {
      await this.repo.setPartyNames(callSid, named.searchText);
    }
  }
}
