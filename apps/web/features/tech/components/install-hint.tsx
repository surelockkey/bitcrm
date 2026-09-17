"use client";

import { useSyncExternalStore } from "react";
import { Share, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  INSTALL_HINT_DISMISSED_KEY,
  installHintKind,
  isStandalone,
  type BeforeInstallPromptEvent,
} from "../pwa";

/* ------------------------------------------------------------------ store */
/**
 * Whether the app can be installed is a fact about the browser, not about
 * React — it arrives as a window event, changes when the user installs, and
 * is the same answer for every component that asks. So it lives in a tiny
 * external store the component subscribes to, rather than in state an effect
 * has to poke on mount.
 *
 * The snapshot starts as `null` ("no hint"), which is also what the server
 * renders, so hydration agrees; the real answer arrives on subscribe.
 */
type HintKind = ReturnType<typeof installHintKind>;

let promptEvent: BeforeInstallPromptEvent | null = null;
let snapshot: HintKind = null;
let dismissed = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function readDismissed(): boolean {
  if (dismissed) return true;
  try {
    return window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === "1";
  } catch {
    return false; // blocked storage — dismissible for this session only
  }
}

function recompute(): void {
  const next = installHintKind({
    standalone: isStandalone(),
    dismissed: readDismissed(),
    promptAvailable: Boolean(promptEvent),
    ua: navigator.userAgent,
  });
  if (next === snapshot) return;
  snapshot = next;
  emit();
}

const onBeforeInstallPrompt = (e: Event) => {
  // Keeping the event is the whole trick: the browser offers it once, and only
  // a stored one can be fired later from a real tap.
  e.preventDefault();
  promptEvent = e as BeforeInstallPromptEvent;
  recompute();
};
const onInstalled = () => {
  promptEvent = null;
  recompute();
};

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
  }
  listeners.add(cb);
  // First read of the real environment happens here, after the server's
  // "nothing to show" has already hydrated.
  recompute();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    }
  };
}

const getSnapshot = (): HintKind => snapshot;
const getServerSnapshot = (): HintKind => null;

function dismiss(): void {
  dismissed = true;
  try {
    window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
  } catch {
    /* in-session only, then */
  }
  recompute();
}

/** Test seam: forget everything this module has learned about the browser. */
export function resetInstallHintForTests(): void {
  promptEvent = null;
  snapshot = null;
  dismissed = false;
  listeners.clear();
}

/* -------------------------------------------------------------- component */

/**
 * "Keep this on your phone" — one line above the day's jobs, shown only when
 * installing is actually possible and only until it is either done or waved
 * away.
 *
 * Two routes, because the platforms differ: Chromium hands us a
 * `beforeinstallprompt` event we can fire on a tap, while iOS Safari has no
 * such API and needs the Share-sheet recipe spelled out. Anything else — a
 * desktop browser, an app already installed — shows nothing at all.
 */
export function InstallHint() {
  const kind = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!kind) return null;

  const install = () => {
    const evt = promptEvent;
    if (!evt) return;
    void (async () => {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      // Either way the event is spent — a second `prompt()` throws.
      promptEvent = null;
      if (outcome === "accepted") dismiss();
      else recompute();
    })();
  };

  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-dashed bg-card p-3"
      data-testid="install-hint"
    >
      <Smartphone className="mt-0.5 size-5 flex-none text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Keep BitCRM on your phone</p>
        {kind === "prompt" ? (
          <>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Opens straight to your jobs, without the browser bars.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={install}
              data-testid="install-hint-add"
            >
              Add to home screen
            </Button>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tap <Share className="inline size-3.5 align-text-bottom" aria-label="Share" /> Share,
            then <strong className="font-medium">Add to Home Screen</strong>.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-m-1 flex size-8 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
