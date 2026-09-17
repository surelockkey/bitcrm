import { router, useIsFocused } from 'expo-router';
import { InboxScreen } from './inbox-screen';

/**
 * What the Messages tab mounts.
 *
 * The tab route owns the tab; this owns what Messages *is*, so the two can be
 * changed apart. Everything the list navigates to lives under
 * `app/(app)/chat/**` and is pushed over the tab bar, which is what makes Back
 * return to the list at the chip and the scroll position the technician left
 * it at — the behaviour Workiz's own list has, and the reason the thread is
 * not a tab of its own.
 *
 * Focus is passed down rather than read inside the screen: it decides whether
 * the list is polled, and a tab that stays mounted behind "My jobs" must not
 * keep asking the server for a list nobody is reading.
 */
export function MessagesTab() {
  return (
    <InboxScreen
      live={useIsFocused()}
      onOpenThread={(row) => router.push(`/chat/conversation/${row.id}`)}
    />
  );
}
