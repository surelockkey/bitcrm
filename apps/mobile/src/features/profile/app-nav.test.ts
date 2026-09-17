import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  TAB_ITEMS,
  accountLine,
  displayName,
  drawerSections,
  menuBadge,
  menuBadgeTone,
  outboxMark,
} from './app-nav';
import { summarizeQueue } from '../queue/lib';
import type { OutboxRecord, QueueRecord } from '../../lib/queue/types';

const queued = (over: Partial<OutboxRecord> = {}): QueueRecord => ({
  queue: 'outbox',
  id: 'q1',
  userId: 'tech-1',
  kind: 'arrived',
  dealId: 'd1',
  payload: '{}',
  createdAt: 0,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  state: 'pending',
  ...over,
});

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
   * A push notification lands on `/chat`
   * (`features/notifications/routing.ts`), and so does a client thread backed
   * out of with no job to return to (`app/(app)/chat/[dealId].tsx`). The label
   * changed; the route must not.
   */
  it('keeps the Messages tab on the /chat route the rest of the app links to', () => {
    expect(TAB_ITEMS.find((t) => t.title === 'Messages')?.name).toBe('chat');
  });

  /**
   * `TAB_ITEMS` orders the bar; it does not decide what is on it. expo-router
   * takes the declared children in order and then **appends every remaining
   * route in the directory** (`expo-router/build/useScreens.js`,
   * `getSortedChildren`), so a file dropped into `app/(app)/(tabs)/` becomes a
   * fourth tab with the assertion above still green. The directory is the
   * other half of the rule, so it is checked here too.
   */
  it('has exactly one file in the tabs directory per tab, and no more', () => {
    const dir = join(__dirname, '..', '..', '..', 'app', '(app)', '(tabs)');
    const routes = readdirSync(dir)
      .filter((name) => name.endsWith('.tsx') && name !== '_layout.tsx')
      .map((name) => name.replace(/\.tsx$/, ''))
      .sort();

    expect(routes).toEqual([...TAB_ITEMS.map((t) => t.name)].sort());
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

  /**
   * The Queue tab went red when something had stopped trying and stayed plain
   * while the phone was only waiting for signal
   * (`app/(app)/(tabs)/_layout.tsx`, before the bar was cut to three). A
   * technician who reads "3" and assumes the phone is handling it walks away
   * from work that is going nowhere, so the row keeps both states.
   */
  it('tells a count of failures apart from a count of things merely waiting', () => {
    const queue = drawerSections()
      .flatMap((s) => s.items)
      .find((i) => i.key === 'queue')!;

    expect(menuBadgeTone(queue, { outbox: '2' })).toBe('default');
    expect(menuBadgeTone(queue, { outbox: '2', outboxFailed: true })).toBe('danger');
    // Only the queue row: nothing else on this menu is about the outbox.
    const jobs = drawerSections()
      .flatMap((s) => s.items)
      .find((i) => i.key === 'jobs')!;
    expect(menuBadgeTone(jobs, { outbox: '2', outboxFailed: true })).toBe('default');

    const failed = drawerSections({ outbox: '2', outboxFailed: true })
      .flatMap((s) => s.items)
      .find((i) => i.key === 'queue')!;
    expect(failed.hint).toContain('stopped trying');
  });
});

describe('outboxMark', () => {
  it('says nothing at all with an empty outbox', () => {
    expect(outboxMark(summarizeQueue([]))).toBeUndefined();
  });

  it('is a plain notice while the phone is only waiting for signal', () => {
    expect(outboxMark(summarizeQueue([queued()]))).toEqual({
      label: 'Menu, something is waiting to send',
      tone: 'notice',
    });
  });

  it('turns danger the moment something has stopped trying', () => {
    expect(
      outboxMark(summarizeQueue([queued(), queued({ id: 'q2', state: 'failed' })])),
    ).toEqual({
      label: 'Menu, something could not be sent',
      tone: 'danger',
    });
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
