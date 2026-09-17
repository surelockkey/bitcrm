import { Share } from 'react-native';
import {
  addressLine,
  clientDisplayName,
  formatDayHeading,
  formatSlot,
  statusLabel,
} from './lib';
import type { Deal } from './types';

/**
 * What the job says when it is passed on.
 *
 * Workiz's job header carries a share/send action, and 2 929 of this account's
 * jobs were sent on from the app (`WORKIZ_MOBILE_APP.md` §0, "Sent to tech by
 * SMS"). Theirs routes through the server's own "Send to tech"; ours hands the
 * phone's share sheet plain text, because the app has no send-to-tech endpoint
 * and inventing one is not this wave's job. The two meet where it matters: one
 * tap from the job header, the job's details land in somebody else's messages.
 *
 * Deliberately the facts and nothing else — no link, no note, no client phone
 * number. This text leaves the app into whatever the technician picked, and
 * what leaves has to be what they would have typed themselves.
 */
export function jobShareText(deal: Deal): string {
  const client = clientDisplayName(deal);
  const address = addressLine(deal.address);
  const day = deal.scheduledDate
    ? formatDayHeading(deal.scheduledDate.slice(0, 10))
    : null;
  const when = day
    ? `${day}, ${formatSlot(deal.scheduledTimeSlot, deal.allDay)}`
    : 'Not scheduled yet';

  return [
    `Job #${deal.dealNumber}`,
    client ? `Client: ${client}` : null,
    address ? `Address: ${address}` : null,
    `When: ${when}`,
    `Status: ${statusLabel(deal.superStatus)}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * Hand the job to the phone's share sheet.
 *
 * Resolves false rather than throwing, the way `openExternalUrl` does: a share
 * sheet the technician backed out of, and one the OS refused to open, are both
 * "nothing happened" as far as this screen is concerned.
 */
export async function shareJob(deal: Deal): Promise<boolean> {
  try {
    const result = await Share.share({
      message: jobShareText(deal),
      title: `Job #${deal.dealNumber}`,
    });
    return result.action === Share.sharedAction;
  } catch {
    return false;
  }
}
