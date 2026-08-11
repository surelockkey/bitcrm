"use client";

import { useEffect } from "react";
import { useSoftphoneStore } from "../softphone-store";
import { disableSoftphone, enableSoftphone } from "../softphone-manager";
import { SoftphoneWidget } from "./softphone-widget";

/**
 * Drives the Twilio Device from the user's phone on/off intent and renders the
 * floating dialer. Mounted once in the app shell (like LocationBroadcaster), so
 * it survives route changes. Renders the widget as a fixed overlay.
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
