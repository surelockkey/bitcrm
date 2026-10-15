"use client";

import { useEffect } from "react";
import { useSoftphoneStore } from "../softphone-store";
import { disableSoftphone, enableSoftphone } from "../softphone-manager";
import { useCallTabTitle } from "../use-call-tab-title";
import { SoftphoneWidget } from "./softphone-widget";
import { usePermissions } from "@/features/auth/use-permissions";

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
  // The softphone switch (Roles → Calls → Use Phone). Without it the phone
  // never connects — a phone left on in this browser is switched off — and
  // there is no dialer; the server refuses the token and presence anyway.
  const { can, isLoading } = usePermissions();
  const mayPhone = !isLoading && can("calls", "phone");

  // Mounted once per tab, which is exactly the scope of a tab title.
  useCallTabTitle();

  useEffect(() => {
    if (isLoading) return;
    if (phoneOn && mayPhone) void enableSoftphone();
    else void disableSoftphone();
  }, [phoneOn, mayPhone, isLoading]);

  // Tear down on full unmount (e.g. logout).
  useEffect(() => () => void disableSoftphone(), []);

  return mayPhone ? <SoftphoneWidget /> : null;
}
