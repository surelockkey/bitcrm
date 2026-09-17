/**
 * The shape of the app: what is a tab, and what is behind the burger.
 *
 * It lives beside the menu that draws it, and it is data rather than JSX so
 * "are there exactly three tabs, in Workiz's order?" is a test instead of a
 * reading of `app/(app)/(tabs)/_layout.tsx`.
 *
 * The reference is a live Workiz for Android 4.281, read off the screens
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §1–§2): three bottom tabs — Home,
 * Schedule, Messages — and everything else in the side menu, headed by the
 * user's name and account. Our technicians have used that app for years, so
 * the structure and the order are theirs; the words on our own screens are
 * ours where Workiz has no equivalent.
 */

import type { MenuMark } from '../../ui/Drawer';
import { tabBadge, type QueueSummaryCounts } from '../queue/lib';

export interface TabItem {
  /** The expo-router file this tab is. */
  name: string;
  /** What it says on the bar. */
  title: string;
  /** What it is, for a screen reader. */
  hint: string;
}

/**
 * The bottom bar, in Workiz's order (§1).
 *
 * Five became three. `My stock`, `Queue` and `Profile` were tabs until this
 * change and are now rows in the menu — Workiz has no tab for any of them, and
 * a technician who reaches for the third tab expecting Messages must find
 * Messages there.
 *
 * `chat` keeps its file name (and so its `/chat` route): push notifications
 * and the job screen both already deep-link to it, and renaming the route to
 * match the label would break those for no gain the technician can see.
 */
export const TAB_ITEMS: readonly TabItem[] = [
  {
    name: 'index',
    title: 'Home',
    hint: 'Your next job and how your day is going',
  },
  {
    name: 'schedule',
    title: 'Schedule',
    hint: 'Your day, as a list or an hour by hour grid',
  },
  {
    name: 'chat',
    title: 'Messages',
    hint: 'Your thread with the office',
  },
] as const;

export interface MenuItem {
  key: string;
  label: string;
  /** What it is for, read out under the label. */
  hint: string;
  /** Where it goes. Absent for a row that does something instead. */
  href?: string;
  tone?: 'default' | 'danger';
}

export interface MenuSection {
  key: string;
  items: MenuItem[];
}

export interface MenuBadges {
  /** The running time clock, "1:24" — Workiz badges Timesheets too (§2). */
  clock?: string;
  /** How much this phone has not managed to send yet. */
  outbox?: string;
  /**
   * Some of it has stopped trying on its own.
   *
   * Not the same thing as `outbox` being set, and the difference is the whole
   * point of saying it: waiting means the phone will send it the moment there
   * is a signal and the technician can walk away; failed means it will sit
   * there until somebody opens the screen and presses the button.
   */
  outboxFailed?: boolean;
}

/**
 * What the burger carries, read straight off the outbox.
 *
 * The Queue tab it replaced had two states — a red badge for something that
 * had stopped trying, a plain one for something merely waiting for signal
 * (`app/(app)/(tabs)/_layout.tsx`, before the bar was cut to three). One dot
 * for both would tell a technician holding a failed "Arrived" that the phone
 * was handling it.
 */
export function outboxMark(counts: QueueSummaryCounts): MenuMark | undefined {
  if (!tabBadge(counts)) return undefined;
  return counts.failed > 0
    ? { label: 'Menu, something could not be sent', tone: 'danger' }
    : { label: 'Menu, something is waiting to send', tone: 'notice' };
}

/**
 * The menu, top to bottom.
 *
 * Workiz's own order is Timesheets · — · Jobs, Price book, Expenses · — ·
 * Settings, Get Help, Log out (§2). Ours keeps the three groups and the two
 * rules between them, and differs in exactly three places, each because of
 * what is or is not behind the row:
 *
 *   - **Price book** and **Expenses** are left out. Neither has an endpoint, a
 *     screen or a row of data on our side, and a menu row that opens nothing
 *     teaches a technician that this menu lies. They belong here the day they
 *     have something behind them.
 *   - **My stock** takes their place in the middle group. Workiz has no van
 *     screen at all (`WORKIZ_MOBILE_APP.md` §1.10), so there is no order of
 *     theirs to match; it sits with the other things a technician opens to
 *     look something up.
 *   - **Waiting to send** is ours and has no Workiz equivalent, because Workiz
 *     has no offline outbox. It goes in the same group, and its count is
 *     mirrored as a dot on the burger so the one thing that must not be missed
 *     is still visible from every screen without opening the menu.
 *
 * Log out carries no `href`: it is an action, and it is last, where it is in
 * Workiz and where a mis-tap is least likely.
 */
export function drawerSections({
  clock,
  outbox,
  outboxFailed,
}: MenuBadges = {}): MenuSection[] {
  return [
    {
      key: 'time',
      items: [
        {
          key: 'timesheets',
          label: 'Timesheets',
          hint: clock
            ? `Clock in and out. You are on the clock, ${clock}`
            : 'Clock in and out, and your hours this week',
          href: '/timesheet',
        },
      ],
    },
    {
      key: 'work',
      items: [
        {
          key: 'jobs',
          label: 'Jobs',
          hint: 'Every job you have been given, day by day',
          href: '/jobs',
        },
        {
          key: 'stock',
          label: 'My stock',
          hint: 'What is on your van',
          href: '/stock',
        },
        {
          key: 'queue',
          label: 'Waiting to send',
          hint: !outbox
            ? 'Anything this phone has not managed to send yet'
            : outboxFailed
              ? `${outbox} still to reach the office, and some of it has stopped trying. Open it and send again`
              : `${outbox} still to reach the office from this phone`,
          href: '/queue',
        },
      ],
    },
    {
      key: 'account',
      items: [
        {
          key: 'settings',
          label: 'Settings',
          hint: 'Location sharing and what this build is',
          href: '/settings',
        },
        {
          key: 'profile',
          label: 'Profile',
          hint: 'Who you are signed in as',
          href: '/profile',
        },
        {
          key: 'logout',
          label: 'Log out',
          hint: 'Signs this phone out of BitCRM',
          tone: 'danger',
        },
      ],
    },
  ];
}

/** The badge a menu row shows, or nothing at all. */
export function menuBadge(item: MenuItem, badges: MenuBadges): string | undefined {
  if (item.key === 'timesheets') return badges.clock;
  if (item.key === 'queue') return badges.outbox;
  return undefined;
}

/** Red on the count, the way the Queue tab's own badge went red. */
export function menuBadgeTone(
  item: MenuItem,
  badges: MenuBadges,
): 'default' | 'danger' {
  return item.key === 'queue' && badges.outboxFailed ? 'danger' : 'default';
}

/**
 * The account line under the technician's name.
 *
 * Workiz shows the company there. `GET /users/me` does not carry one — the
 * nearest thing it has is the department — so rather than invent a company
 * name the row falls back to the address they signed in with, which is at
 * least true and is what the office would ask them for.
 */
export function accountLine(user: {
  department?: string;
  email?: string;
} | null | undefined): string {
  if (!user) return '';
  return user.department?.trim() || user.email || '';
}

/** "Dana Reyes", or the email when the office never filled in a name. */
export function displayName(user: {
  firstName?: string;
  lastName?: string;
  email?: string;
} | null | undefined): string {
  if (!user) return '';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || '';
}
