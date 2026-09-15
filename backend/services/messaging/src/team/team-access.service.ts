import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { getDataScopeFilter, hasPermission } from '@bitcrm/shared';
import {
  DataScope,
  type Conversation,
  type ConversationKind,
  type JwtUser,
  type ResolvedPermissions,
} from '@bitcrm/types';

/** The two staff-chat kinds (design §6): one employee, or a group of them. */
export const TEAM_KINDS: ReadonlyArray<ConversationKind> = ['team', 'group'];
export const isTeamKind = (kind: ConversationKind): boolean => TEAM_KINDS.includes(kind);

/**
 * The `team_chat` data scope, resolved for one caller (design §7.5):
 *
 * `all` — the office (admins, dispatchers, department managers): every
 * employee thread and every group, like the Workiz Inbox "Team" category.
 * `own` — a technician: their own thread with the office and the groups
 * they are a member of. `department` widens to `all` (threads carry no
 * department), and an unresolved caller is scoped down.
 */
export type TeamScope = { scope: 'all' } | { scope: 'own'; userId: string };

export interface TeamViewer {
  user: JwtUser;
  scope: TeamScope;
  /** `team_chat.send` — may write in a thread they can see. */
  maySend: boolean;
  /** `team_chat.manage_groups` — may create groups and change membership. */
  mayManageGroups: boolean;
  /** `contacts.view_numbers` — the same grant masks a teammate's personal phone on the thread. */
  seesNumbers: boolean;
}

@Injectable()
export class TeamAccessService {
  viewerFor(user: JwtUser, perms: ResolvedPermissions | undefined): TeamViewer {
    return {
      user,
      scope: this.scopeFor(user, perms),
      maySend: hasPermission(perms, 'team_chat', 'send'),
      mayManageGroups: hasPermission(perms, 'team_chat', 'manage_groups'),
      seesNumbers: hasPermission(perms, 'contacts', 'view_numbers'),
    };
  }

  scopeFor(user: JwtUser, perms: ResolvedPermissions | undefined): TeamScope {
    if (!perms) return { scope: 'own', userId: user.id };
    const filter = getDataScopeFilter(user, 'team_chat', perms);
    return filter.scope === DataScope.ASSIGNED_ONLY ? { scope: 'own', userId: user.id } : { scope: 'all' };
  }

  /** Is this a staff thread the viewer may read? Client threads are never "team", whatever the scope. */
  canAccess(c: Conversation, scope: TeamScope): boolean {
    if (!isTeamKind(c.kind)) return false;
    if (scope.scope === 'all') return true;
    if (c.kind === 'team') return c.partyKind === 'user' && c.partyId === scope.userId;
    return (c.memberIds ?? []).includes(scope.userId);
  }

  /** 404 for anything that is not a staff thread (it exists, but not here), 403 outside the scope. */
  assertAccess(c: Conversation, scope: TeamScope): void {
    if (!isTeamKind(c.kind)) throw new NotFoundException('Not a team conversation');
    if (!this.canAccess(c, scope)) throw new ForbiddenException('Conversation is outside your team-chat scope');
  }
}
