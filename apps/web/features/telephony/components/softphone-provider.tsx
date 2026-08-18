"use client";

import { useEffect } from "react";
import { useSoftphoneStore } from "../softphone-store";
import { disableSoftphone, enableSoftphone } from "../softphone-manager";
import { SoftphoneWidget } from "./softphone-widget";

/**
 * Drives the Twilio Device from the user's phone on/off intent and renders the
 * floating dialer. Mounted once in the app shell (like LocationBroadcaster), so
 * it survives route changes. Renders the widget as a fixed overlay.
 *
 * Every tab registers: `phoneOn` is persisted, so the phone is on wherever you
 * are, and each tab can ring, answer and dial. A live call still lives in one
 * of them — the widget mirrors it from the server in the others, and can take
 * it over.
 */
export function SoftphoneProvider() {
  const phoneOn = useSoftphoneStore((s) => s.phoneOn);

  useEffect(() => {
    if (phoneOn) void enableSoftphone();
    else void disableSoftphone();
  }, [phoneOn]);

  // Tear down on full unmount (e.g. logout).
  useEffect(() => () => void disableSoftphone(), []);

  return <SoftphoneWidget />;
}
