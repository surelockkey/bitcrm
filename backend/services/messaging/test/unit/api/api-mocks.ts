import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { type DealForMessaging } from '../../../src/api/access/deal-read.service';

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------
export const ADMIN: JwtUser = {
  id: 'admin-1',
  cognitoSub: 'sub-admin',
  email: 'admin@example.com',
  roleId: 'role-admin',
  department: 'ops',
};

export const TECH: JwtUser = {
  id: 'tech-1',
  cognitoSub: 'sub-tech',
  email: 'tech@example.com',
  roleId: 'role-tech',
  department: 'field',
};

/** Full-scope viewer who may see numbers. */
export function adminPerms(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    roleId: 'role-admin',
    roleName: 'Admin',
    isSystemRole: true,
    permissions: {
      messages: { view: true, send: true, manage: true },
      team_chat: { view: true, send: true, manage_groups: true },
      contacts: { view: true, view_numbers: true },
    },
    dataScope: { messages: 'all' as never, contacts: 'all' as never },
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

/** `assigned_only` viewer without `contacts.view_numbers`. */
export function techPerms(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    roleId: 'role-tech',
    roleName: 'Technician',
    isSystemRole: true,
    permissions: {
      messages: { view: true, send: true, manage: false },
      team_chat: { view: true, send: true, manage_groups: false },
      contacts: { view: true, view_numbers: false },
    },
    dataScope: { messages: 'assigned_only' as never, contacts: 'assigned_only' as never },
    dealStageTransitions: [],
    hasOverrides: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Collaborators
// ---------------------------------------------------------------------------
export function createMockDeal(overrides: Partial<DealForMessaging> = {}): DealForMessaging {
  return {
    id: 'd1',
    dealNumber: '1042',
    contactId: 'ct1',
    assignedTechIds: ['tech-1'],
    superStatus: 'submitted',
    ...overrides,
  };
}

/** A `ConversationsRepository` with every read/write a jest.fn (defaults: nothing found). */
export function mockConversationsRepo() {
  return {
    get: jest.fn().mockResolvedValue(null),
    getByParty: jest.fn().mockResolvedValue(null),
    getByAddress: jest.fn().mockResolvedValue(null),
    getReadMarker: jest.fn().mockResolvedValue(null),
    listInbox: jest.fn().mockResolvedValue({ items: [] }),
    update: jest.fn(),
    markRead: jest.fn(),
    // Team / group (§6)
    findOrCreate: jest.fn(async (input: { conversation: unknown }) => ({ conversation: input.conversation, created: true })),
    createGroup: jest.fn(async (conversation: unknown, members: Array<{ userId: string }>) => ({
      ...(conversation as object),
      memberIds: members.map((m) => m.userId),
    })),
    updateMembers: jest.fn(),
    getMember: jest.fn().mockResolvedValue(null),
    listMembers: jest.fn().mockResolvedValue([]),
    listMemberOf: jest.fn().mockResolvedValue([]),
    putReadMarker: jest.fn(async (conversationId: string, userId: string, opts: { lastReadMessageSk?: string; at?: string } = {}) => ({
      conversationId,
      userId,
      lastReadAt: opts.at ?? '2026-09-15T12:00:00.000Z',
      lastReadMessageSk: opts.lastReadMessageSk,
    })),
    listReadMarkers: jest.fn().mockResolvedValue([]),
    countMessagesAfter: jest.fn().mockResolvedValue(0),
    putAddressPointer: jest.fn().mockResolvedValue(undefined),
  };
}

export function mockMessagesRepo() {
  return {
    listByConversation: jest.fn().mockResolvedValue({ items: [] }),
    listByJob: jest.fn().mockResolvedValue({ items: [] }),
    listFlagged: jest.fn().mockResolvedValue({ items: [] }),
    get: jest.fn().mockResolvedValue(null),
    setFlagged: jest.fn().mockResolvedValue(undefined),
  };
}

export function mockDealRead(overrides: Partial<Record<'find' | 'listByTech', jest.Mock>> = {}) {
  return {
    find: jest.fn().mockResolvedValue(null),
    listByTech: jest.fn().mockResolvedValue([]),
    forget: jest.fn(),
    ...overrides,
  };
}

export function mockOptOutsRepo() {
  return {
    get: jest.fn().mockResolvedValue(null),
    isOptedOut: jest.fn().mockResolvedValue(false),
  };
}

export function mockCountersRepo() {
  return {
    get: jest.fn().mockResolvedValue({ unreadConversations: 3, flaggedConversations: 1, unreadByKind: { client: 3 } }),
  };
}

/** A `fetch` that answers from a routing table keyed by URL substring. */
export function mockFetch(routes: Record<string, { status?: number; body?: unknown } | Error>) {
  return jest.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { status: 404 };
    if (route instanceof Error) throw route;
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}
