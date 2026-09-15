import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TeamAccessService, isTeamKind } from '../../../src/team/team-access.service';
import { createMockConversation } from '../mocks';
import { ADMIN, TECH, adminPerms, techPerms } from '../api/api-mocks';

const access = new TeamAccessService();
const OWN = { scope: 'own' as const, userId: 'tech-1' };
const MINE = createMockConversation({ id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1', addresses: { phones: [], emails: [] } });
const OTHER = createMockConversation({ id: 'c-other', kind: 'team', partyKind: 'user', partyId: 'tech-2', addresses: { phones: [], emails: [] } });
const GROUP = createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', memberIds: ['tech-1', 'admin-1'], addresses: { phones: [], emails: [] } });

describe('TeamAccessService.scopeFor / viewerFor', () => {
  it('reads the team_chat data scope: all for the office, own for a technician, own when unresolved', () => {
    expect(access.scopeFor(ADMIN, adminPerms({ dataScope: { team_chat: 'all' as never } }))).toEqual({ scope: 'all' });
    expect(access.scopeFor(ADMIN, adminPerms({ dataScope: { team_chat: 'department' as never } }))).toEqual({ scope: 'all' });
    expect(access.scopeFor(TECH, techPerms({ dataScope: { team_chat: 'assigned_only' as never } }))).toEqual(OWN);
    expect(access.scopeFor(TECH, techPerms({ dataScope: {} }))).toEqual(OWN);
    expect(access.scopeFor(TECH, undefined)).toEqual(OWN);
    expect(access.scopeFor(TECH, techPerms({ roleName: 'Super Admin', isSystemRole: true, dataScope: {} }))).toEqual({ scope: 'all' });
  });

  it('carries send / manage_groups / view_numbers', () => {
    const admin = access.viewerFor(ADMIN, adminPerms({ dataScope: { team_chat: 'all' as never } }));
    expect(admin).toMatchObject({ scope: { scope: 'all' }, maySend: true, mayManageGroups: true, seesNumbers: true });
    const tech = access.viewerFor(TECH, techPerms({ dataScope: { team_chat: 'assigned_only' as never } }));
    expect(tech).toMatchObject({ scope: OWN, maySend: true, mayManageGroups: false, seesNumbers: false });
    expect(access.viewerFor(TECH, undefined)).toMatchObject({ maySend: false, mayManageGroups: false });
  });
});

describe('TeamAccessService.canAccess / assertAccess', () => {
  it('the office sees every staff thread; nobody sees a client thread through the team API', () => {
    expect(access.canAccess(MINE, { scope: 'all' })).toBe(true);
    expect(access.canAccess(GROUP, { scope: 'all' })).toBe(true);
    expect(access.canAccess(createMockConversation(), { scope: 'all' })).toBe(false);
    expect(isTeamKind('client')).toBe(false);
  });

  it('a technician sees their own thread and their groups only', () => {
    expect(access.canAccess(MINE, OWN)).toBe(true);
    expect(access.canAccess(OTHER, OWN)).toBe(false);
    expect(access.canAccess(GROUP, OWN)).toBe(true);
    expect(access.canAccess({ ...GROUP, memberIds: ['admin-1'] }, OWN)).toBe(false);
    expect(access.canAccess({ ...GROUP, memberIds: undefined }, OWN)).toBe(false);
  });

  it('assertAccess: 404 for a client thread, 403 outside the scope', () => {
    expect(() => access.assertAccess(createMockConversation(), { scope: 'all' })).toThrow(NotFoundException);
    expect(() => access.assertAccess(OTHER, OWN)).toThrow(ForbiddenException);
    expect(() => access.assertAccess(MINE, OWN)).not.toThrow();
  });
});
