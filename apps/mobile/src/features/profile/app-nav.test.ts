import {
  TAB_ITEMS,
  accountLine,
  displayName,
  drawerSections,
  menuBadge,
} from './app-nav';

describe('TAB_ITEMS', () => {
  /**
   * The whole point of this wave. Workiz has exactly three bottom tabs, in
   * this order (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §1), and a technician
   * who has used that app for years reaches for the third one expecting
   * Messages. A fourth tab creeping back in is a regression this catches.
   */
  it('is Workiz’s three, in Workiz’s order', () => {
    expect(TAB_ITEMS.map((t) => t.title)).toEqual(['Home', 'Schedule', 'Messages']);
  });

  it('gives every tab a name a screen reader can read', () => {
    for (const tab of TAB_ITEMS) {
      expect(tab.title.trim().length).toBeGreaterThan(0);
      expect(tab.hint.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * Push notifications and the job screen both deep-link to `/chat`
   * (`features/notifications/routing.ts`, `app/(app)/jobs/[id]/index.tsx`).
   * The label changed; the route must not.
   */
  it('keeps the Messages tab on the /chat route the rest of the app links to', () => {
    expect(TAB_ITEMS.find((t) => t.title === 'Messages')?.name).toBe('chat');
  });
});

describe('drawerSections', () => {
  const keys = () => drawerSections().flatMap((s) => s.items.map((i) => i.key));

  /**
   * Workiz's menu is Timesheets · — · Jobs, Price book, Expenses · — ·
   * Settings, Get Help, Log out (§2). Three groups, two rules, Log out last.
   */
  it('keeps Workiz’s three groups and their order', () => {
    expect(drawerSections().map((s) => s.key)).toEqual(['time', 'work', 'account']);
    expect(keys()).toEqual([
      'timesheets',
      'jobs',
      'stock',
      'queue',
      'settings',
      'profile',
      'logout',
    ]);
  });

  /**
   * A menu row that opens nothing teaches a technician that the menu lies.
   * Neither Price book nor Expenses has an endpoint, a screen or a row of data
   * on our side, so neither is offered until it does.
   */
  it('offers no row with nothing behind it', () => {
    expect(keys()).not.toContain('pricebook');
    expect(keys()).not.toContain('expenses');
  });

  it('points every row but Log out at a screen', () => {
    for (const item of drawerSections().flatMap((s) => s.items)) {
      if (item.key === 'logout') expect(item.href).toBeUndefined();
      else expect(item.href).toMatch(/^\//);
    }
  });

  it('reaches everything that used to be a tab', () => {
    const hrefs = drawerSections()
      .flatMap((s) => s.items)
      .map((i) => i.href);
    expect(hrefs).toEqual(
      expect.arrayContaining(['/jobs', '/stock', '/queue', '/profile']),
    );
  });

  it('marks Log out as the one row there is no way back from', () => {
    const logout = drawerSections()
      .flatMap((s) => s.items)
      .find((i) => i.key === 'logout');
    expect(logout?.tone).toBe('danger');
  });

  it('gives every row something for a screen reader to read', () => {
    for (const item of drawerSections().flatMap((s) => s.items)) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.hint.trim().length).toBeGreaterThan(0);
    }
  });

  /** A running clock and unsent work are the two things worth saying twice. */
  it('says the running clock and the outbox in the hint as well as the badge', () => {
    const items = drawerSections({ clock: '1:24', outbox: '3' }).flatMap((s) => s.items);
    const timesheets = items.find((i) => i.key === 'timesheets')!;
    const queue = items.find((i) => i.key === 'queue')!;

    expect(timesheets.hint).toContain('1:24');
    expect(queue.hint).toContain('3');
    expect(menuBadge(timesheets, { clock: '1:24' })).toBe('1:24');
    expect(menuBadge(queue, { outbox: '3' })).toBe('3');
    expect(menuBadge(items.find((i) => i.key === 'jobs')!, { outbox: '3' })).toBeUndefined();
  });

  it('badges nothing when there is nothing to say', () => {
    const items = drawerSections().flatMap((s) => s.items);
    expect(menuBadge(items[0], {})).toBeUndefined();
  });
});

describe('the menu header', () => {
  it('is the name over the account, as Workiz has it', () => {
    const user = {
      firstName: 'Dana',
      lastName: 'Reyes',
      email: 'tech@slk-s.com',
      department: 'Sure Lock & Key',
    };
    expect(displayName(user)).toBe('Dana Reyes');
    expect(accountLine(user)).toBe('Sure Lock & Key');
  });

  /**
   * `GET /users/me` carries no company name. Rather than invent one, the line
   * falls back to the address they signed in with — true, and the thing the
   * office would ask them for.
   */
  it('falls back to the email rather than inventing a company', () => {
    expect(accountLine({ email: 'tech@slk-s.com' })).toBe('tech@slk-s.com');
    expect(displayName({ email: 'tech@slk-s.com' })).toBe('tech@slk-s.com');
  });

  it('says nothing at all with nobody signed in', () => {
    expect(displayName(null)).toBe('');
    expect(accountLine(undefined)).toBe('');
  });
});
