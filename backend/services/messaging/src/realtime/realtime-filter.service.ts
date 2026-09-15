import { Injectable } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import { type Conversation, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { ConversationScopeService, type MessagingScope } from '../api/access/conversation-scope.service';
import { looksLikePhone, maskConversation, maskMessage } from '../api/access/masking';
import { CountersService } from '../api/counters/counters.service';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { type MessagingRealtimeEvent } from './realtime-events';

/** Everything the stream knows about the person on the other end, refreshed per event. */
export interface RealtimeViewer {
  user: JwtUser;
  mayViewMessages: boolean;
  mayViewTeamChat: boolean;
  scope: MessagingScope;
  seesNumbers: boolean;
}

/** Counters for an `assigned_only` viewer are recounted at most this often per connection. */
export const SCOPED_COUNTERS_MIN_INTERVAL_MS = 5_000;

/**
 * Decides, per viewer and per event, what goes down the wire (design §7.6:
 * "every event is filtered by the user's data scope and masked at send
 * time"). Returns the event to write, or `null` to drop it. Anything that
 * cannot be decided — a missing conversation, a failed deal lookup — is a
 * drop, never a leak.
 */
@Injectable()
export class RealtimeFilterService {
  constructor(
    private readonly scope: ConversationScopeService,
    private readonly conversations: ConversationsRepository,
    private readonly counters: CountersService,
  ) {}

  viewerFor(user: JwtUser, perms: ResolvedPermissions | null): RealtimeViewer {
    return {
      user,
      mayViewMessages: hasPermission(perms, 'messages', 'view'),
      mayViewTeamChat: hasPermission(perms, 'team_chat', 'view'),
      scope: this.scope.scopeFor(user, perms ?? undefined),
      seesNumbers: hasPermission(perms, 'contacts', 'view_numbers'),
    };
  }

  /** May this viewer open the stream at all? */
  mayConnect(viewer: RealtimeViewer): boolean {
    return viewer.mayViewMessages || viewer.mayViewTeamChat;
  }

  async forViewer(event: MessagingRealtimeEvent, viewer: RealtimeViewer): Promise<MessagingRealtimeEvent | null> {
    switch (event.type) {
      case 'conversation.upserted': {
        if (!(await this.conversationVisible(event.conversation, viewer))) return null;
        return { ...event, conversation: maskConversation(event.conversation, viewer.seesNumbers) };
      }
      case 'message.upserted': {
        const conversation = event.conversation ?? (await this.conversations.get(event.message.conversationId));
        if (!conversation || !(await this.conversationVisible(conversation, viewer))) return null;
        return {
          ...event,
          message: maskMessage(event.message, viewer.seesNumbers),
          conversation: maskConversation(conversation, viewer.seesNumbers),
        };
      }
      case 'counters.changed': {
        if (!viewer.mayViewMessages) return null;
        if (viewer.scope.scope === 'all') return event;
        // Never the company-wide numbers: recount over the viewer's own threads.
        return { ...event, counters: await this.counters.getForScope(viewer.scope) };
      }
      case 'opt_out.changed': {
        if (!viewer.mayViewMessages) return null;
        if (viewer.seesNumbers || !looksLikePhone(event.address)) return event;
        return { ...event, address: undefined };
      }
      default:
        return null;
    }
  }

  /**
   * A team / group thread is visible to anyone with `team_chat.view` (scope
   * still applies: a technician sees only their own); everything else needs
   * `messages.view`.
   */
  private async conversationVisible(c: Conversation, viewer: RealtimeViewer): Promise<boolean> {
    const isTeam = c.kind === 'team' || c.kind === 'group';
    const allowedByPermission = isTeam ? viewer.mayViewTeamChat || viewer.mayViewMessages : viewer.mayViewMessages;
    if (!allowedByPermission) return false;
    try {
      return await this.scope.canAccess(c, viewer.scope);
    } catch {
      return false;
    }
  }
}

/**
 * Leading + trailing throttle: the first call runs at once, calls during
 * the cooldown collapse into one more run when it ends — so a burst of
 * counter changes costs an `assigned_only` connection one recount per
 * interval and the last change is always reflected.
 */
export function throttleTrailing(fn: () => Promise<void> | void, intervalMs: number): { call: () => void; cancel: () => void } {
  let cooling = false;
  let again = false;
  let timer: NodeJS.Timeout | null = null;
  let cancelled = false;

  const run = () => {
    cooling = true;
    void Promise.resolve()
      .then(fn)
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        timer = setTimeout(() => {
          timer = null;
          cooling = false;
          if (again) {
            again = false;
            run();
          }
        }, intervalMs);
      });
  };

  return {
    call: () => {
      if (cancelled) return;
      if (cooling) {
        again = true;
        return;
      }
      run();
    },
    cancel: () => {
      cancelled = true;
      again = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
