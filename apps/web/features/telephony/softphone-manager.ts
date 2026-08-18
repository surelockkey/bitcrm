import type { Call, Device } from "@twilio/voice-sdk";
import { normalizePhone } from "@/lib/phone";
import { useSoftphoneStore } from "./softphone-store";
import {
  fetchVoiceToken,
  identifyNumber,
  setPresence,
} from "./api";
import { completeTakeCall, requestTakeCall } from "@/features/calls/api";

/**
 * Imperative singleton that owns the Twilio Device and the active Call. React
 * components stay declarative: they read the store and call these functions.
 * The Twilio SDK is browser-only, so it's dynamically imported at enable time
 * (never during SSR/module load).
 */

let device: Device | null = null;
let currentCall: Call | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let starting = false;
/**
 * Monotonic session id. Every enable claims one; disable bumps it. Any async
 * step in enable re-checks its id and bails if a disable (or newer enable) has
 * superseded it — this is what prevents refresh / React-dev double-mount /
 * rapid toggling from leaving an orphaned, half-registered Device behind.
 */
let sessionId = 0;
let onVisible: (() => void) | null = null;

const HEARTBEAT_MS = 25_000;
const store = () => useSoftphoneStore.getState();

/** Refresh online presence immediately (used by heartbeat + focus/visibility). */
function pingPresence() {
  if (device) void setPresence(true).catch(() => {});
}

async function refreshToken() {
  try {
    const { token } = await fetchVoiceToken();
    device?.updateToken(token);
  } catch {
    /* the next tokenWillExpire / re-register will retry */
  }
}

/** Destroy a Device safely regardless of its current state. */
async function teardownDevice(d: Device): Promise<void> {
  try {
    d.disconnectAll();
  } catch {
    /* no active calls */
  }
  try {
    // unregister() only valid from the "registered" state and returns a
    // promise that REJECTS otherwise — await+catch so it can't surface as an
    // unhandledRejection.
    if ((d.state as string) === "registered")
      await d.unregister().catch(() => {});
  } catch {
    /* ignore */
  }
  try {
    d.destroy();
  } catch {
    /* ignore */
  }
}

export async function enableSoftphone(): Promise<void> {
  if (device || starting) return;
  starting = true;
  const mySession = ++sessionId;
  store().setStatus("connecting");

  try {
    const { token } = await fetchVoiceToken();
    const { Device } = await import("@twilio/voice-sdk");
    if (mySession !== sessionId) return; // superseded while loading

    const d = new Device(token, { logLevel: "error", closeProtection: true });
    d.on("registered", () => store().setStatus("online"));
    d.on("unregistered", () => store().setStatus("offline"));
    d.on("error", (e: { message?: string }) =>
      store().setStatus("error", e?.message ?? "Softphone error"),
    );
    d.on("tokenWillExpire", () => void refreshToken());
    d.on("incoming", (call: Call) => void handleIncoming(call));

    device = d;
    await d.register();

    if (mySession !== sessionId) {
      // Disabled (or re-enabled) during registration — tidy up this instance.
      await teardownDevice(d);
      return;
    }

    await setPresence(true).catch(() => {});
    heartbeat = setInterval(pingPresence, HEARTBEAT_MS);

    // Background tabs throttle the heartbeat timer, so also refresh presence
    // the moment the tab regains focus/visibility — this closes the window
    // where an agent is reachable (Device still connected) but marked offline.
    onVisible = () => {
      if (document.visibilityState === "visible") pingPresence();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
  } catch (e) {
    if (mySession === sessionId) {
      const message =
        e instanceof Error ? e.message : "Failed to start softphone";
      store().setStatus("error", message);
      await disableSoftphone();
    }
  } finally {
    starting = false;
  }
}

export async function disableSoftphone(): Promise<void> {
  sessionId++; // cancel any in-flight enable
  starting = false;
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  if (onVisible) {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    onVisible = null;
  }
  void setPresence(false).catch(() => {});
  currentCall = null;
  const d = device;
  device = null;
  if (d) await teardownDevice(d);
  store().setCall("idle", null);
  store().setStatus("offline");
}

function endCall() {
  currentCall = null;
  store().setCall("idle", null);
}

function wireCall(call: Call) {
  currentCall = call;
  call.on("accept", () => {
    const existing = store().call;
    store().setCall("active", existing);
    store().patchCall({ startedAt: Date.now() });
  });
  call.on("disconnect", endCall);
  call.on("cancel", endCall);
  call.on("reject", endCall);
  call.on("error", endCall);
}

async function screenPop(e164: string) {
  const party = await identifyNumber(e164);
  if (party?.name) store().patchCall({ contactName: party.name });
}

async function handleIncoming(call: Call) {
  const from = call.parameters.From ?? "Unknown";
  store().setCall("incoming", { direction: "inbound", number: from });
  store().setDialerOpen(true);
  wireCall(call);
  const e164 = normalizePhone(from);
  if (e164) void screenPop(e164);
}

export async function startCall(rawNumber: string): Promise<void> {
  if (!device) return;
  const e164 = normalizePhone(rawNumber);
  if (!e164) {
    store().setStatus("error", "Enter a valid phone number");
    return;
  }
  store().setStatus("online");
  store().setCall("connecting", { direction: "outbound", number: e164 });
  store().setDialerOpen(true);
  void screenPop(e164);
  try {
    // CallerId lets the outbound webhook pick which of our numbers to dial from;
    // omitted/blank → the backend uses the default number.
    const activeNumber = store().activeNumber ?? "";
    const call = await device.connect({
      params: { To: e164, CallerId: activeNumber },
    });
    wireCall(call);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Call failed";
    store().setStatus("error", message);
    endCall();
  }
}

/**
 * Supervise a live call: connect this device into its conference. The backend
 * webhook validates the single-use grant (requested just before via
 * `requestMonitor`) and joins muted (listen) or unmuted (join). Leaving never
 * ends the supervised call (endConferenceOnExit=false on the monitor leg).
 */
export async function monitorCall(
  conferenceName: string,
  mode: "listen" | "join",
  label?: string,
): Promise<void> {
  if (!device || currentCall) return;
  store().setCall("connecting", {
    direction: "outbound",
    number: label ?? conferenceName,
    monitor: mode,
  });
  store().setDialerOpen(true);
  try {
    const call = await device.connect({
      params: { Monitor: conferenceName, MonitorMode: mode },
    });
    wireCall(call);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not join the call";
    store().setStatus("error", message);
    endCall();
  }
}

/**
 * Take a call this user is already on into this tab.
 *
 * The audio can't be moved — but every BitCRM call is a conference, so this
 * tab joins it and the previous tab's leg is dropped afterwards. Join first,
 * drop second: the customer stays in a conference that never empties, so they
 * hear no gap and no hold music.
 *
 * The Device has to be up first — a follower tab doesn't register one until it
 * needs to, which is now.
 */
export async function takeCallHere(
  callSid: string,
  label?: string,
): Promise<void> {
  if (currentCall) return;
  if (!device) {
    await enableSoftphone();
    if (!device) return;
  }

  let previousLegs: string[] = [];
  try {
    const grant = await requestTakeCall(callSid);
    previousLegs = grant.previousLegs;

    store().setCall("connecting", {
      direction: "outbound",
      number: label ?? grant.conferenceName,
    });
    store().setDialerOpen(true);

    const call = await device.connect({
      params: { Monitor: grant.conferenceName, MonitorMode: "join" },
    });
    wireCall(call);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not take the call";
    store().setStatus("error", message);
    endCall();
    return;
  }

  // Only now is this tab genuinely on the call. Failing here leaves the old
  // tab connected too — both hear the customer, which is recoverable by
  // hanging up one of them; dropping first would not have been.
  try {
    await completeTakeCall(callSid, previousLegs);
  } catch {
    store().setStatus(
      "error",
      "Took the call, but the other tab is still connected — hang up there.",
    );
  }
}

export function acceptIncoming() {
  currentCall?.accept();
}

export function rejectIncoming() {
  try {
    currentCall?.reject();
  } finally {
    endCall();
  }
}

export function hangup() {
  try {
    currentCall?.disconnect();
  } finally {
    endCall();
  }
}

export function toggleMute() {
  if (!currentCall) return;
  const next = !store().muted;
  currentCall.mute(next);
  store().setMuted(next);
}

export function sendDigit(digit: string) {
  currentCall?.sendDigits(digit);
}
