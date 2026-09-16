/**
 * Installing BitCRM on a phone — the small amount of it that is pure logic,
 * kept out of the component so it can be tested without a browser.
 *
 * ## What "installed" buys a technician
 *
 * A home-screen launch opens in `standalone` display: no address bar, no
 * browser back/forward. On a phone that is roughly a third of the screen back,
 * and one fewer way to lose a half-filled note mid-job.
 *
 * ## What Web Push would need (NOT built here)
 *
 * Push is the reason to install rather than bookmark — "you have a new job",
 * "the client replied" — and it is deliberately out of this change. When it
 * is picked up, it needs, in this order:
 *
 *  1. **A service worker** (`public/sw.js`, registered after load). Today the
 *     app registers none; a push subscription is impossible without one, since
 *     the browser delivers push events to a worker, not to a page.
 *  2. **A VAPID key pair.** The public half ships to the client as
 *     `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and is passed to
 *     `registration.pushManager.subscribe({ userVisibleOnly: true,
 *     applicationServerKey })`; the private half stays in the backend's
 *     secrets and signs every send.
 *  3. **Subscription storage**, per user AND per device — one technician has a
 *     phone and a tablet, and a subscription belongs to a browser install, not
 *     to a person. A `PUSH_SUB#<endpointHash>` row under the user, with the
 *     endpoint, `p256dh` and `auth` keys, plus a last-seen stamp so dead
 *     subscriptions can be pruned (a push that 404s/410s is gone for good and
 *     must be deleted, or every later send retries it).
 *  4. **A sender** in the backend — RFC 8291 encryption + RFC 8030 delivery
 *     (the `web-push` library is the usual answer; that is a dependency
 *     decision, hence not taken here). It fans out on the events that already
 *     exist: `deal.tech_assigned`, a team-chat message, `deal.status_changed`.
 *  5. **Permission asked at the right moment** — after a technician taps
 *     something that implies they want to be told, never on first load, since
 *     a denied permission cannot be re-asked without the user digging through
 *     browser settings.
 *  6. **iOS**: Safari only allows push for an app already added to the home
 *     screen (16.4+), so the install hint below is a prerequisite there, not
 *     an extra.
 */

/** Is the app already running as an installed app rather than in a tab? */
export function isStandalone(win: Window = window): boolean {
  try {
    if (win.matchMedia?.("(display-mode: standalone)").matches) return true;
    // Safari's own, pre-standard flag — still the only signal on iOS.
    return (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** iOS Safari never fires `beforeinstallprompt`; it needs the Share-sheet recipe instead. */
export function isIosSafari(ua: string): boolean {
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua));
  if (!ios) return false;
  // Chrome/Firefox/Edge on iOS are Safari underneath but cannot install.
  return !/crios|fxios|edgios/i.test(ua);
}

export const INSTALL_HINT_DISMISSED_KEY = "bitcrm.pwa.install-hint-dismissed";

/**
 * Which hint (if any) to show: the browser's own prompt when one was offered,
 * the iOS recipe when that is the only route, and nothing at all once the app
 * is installed or the technician has waved the hint away.
 */
export function installHintKind(opts: {
  standalone: boolean;
  dismissed: boolean;
  promptAvailable: boolean;
  ua: string;
}): "prompt" | "ios" | null {
  if (opts.standalone || opts.dismissed) return null;
  if (opts.promptAvailable) return "prompt";
  return isIosSafari(opts.ua) ? "ios" : null;
}

/** The Chromium-only event the install button rides on. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
