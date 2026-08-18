"use client";

import { useEffect } from "react";
import { useSoftphoneStore } from "../softphone-store";
import { disableSoftphone, enableSoftphone } from "../softphone-manager";
import { useTabOwner } from "../use-tab-owner";
import { SoftphoneWidget } from "./softphone-widget";

/**
 * Drives the Twilio Device from the user's phone on/off intent and renders the
 * floating dialer. Mounted once in the app shell (like LocationBroadcaster), so
 * it survives route changes. Renders the widget as a fixed overlay.
 *
 * Only the tab that owns the phone registers a Device: `phoneOn` is persisted,
 * so without this every open tab would register under the same identity. A
 * follower still renders the widget — it mirrors the call from the server and
 * can take it over.
 */
export function SoftphoneProvider() {
  const phoneOn = useSoftphoneStore((s) => s.phoneOn);
  const isOwner = useTabOwner();

  useEffect(() => {
    if (phoneOn && isOwner) void enableSoftphone();
    else void disableSoftphone();
  }, [phoneOn, isOwner]);

  // Tear down on full unmount (e.g. logout).
  useEffect(() => () => void disableSoftphone(), []);

  return <SoftphoneWidget />;
}
