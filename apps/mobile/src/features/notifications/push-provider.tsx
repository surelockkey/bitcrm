import React, { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { ensureAndroidChannel, registerPushDevice } from './device';
import { foregroundBehavior } from './policy';
import { routeForPushData } from './routing';

/**
 * Push, wired to the app.
 *
 * Mounted inside `(app)`, which only exists with a session, so everything here
 * is by definition on behalf of a signed-in technician: the token this
 * registers belongs to them, and signing out releases it
 * (`device.ts#releasePushDevice`, called from the auth provider before the
 * tokens go).
 *
 * Renders nothing and blocks nothing. Every failure path is quiet by design —
 * see `device.ts` for why that is the only honest option while remote delivery
 * is still waiting on accounts that do not exist.
 */
export function PushProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  /*
   * The foreground handler is registered once and lives as long as the app, so
   * it cannot close over a pathname. A ref can: the handler reads whatever
   * screen the technician is on at the moment the notification lands, which is
   * what decides whether a banner would be covering the thing it announces.
   */
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) =>
        foregroundBehavior(notification.request.content.data, pathRef.current),
    });
    return () => Notifications.setNotificationHandler(null);
  }, []);

  useEffect(() => {
    void ensureAndroidChannel();
    // Fire and forget: nothing on screen waits for this, and it resolves to a
    // description of what happened rather than throwing.
    void registerPushDevice();
  }, []);

  /*
   * A tap opens the thing the notification is about.
   *
   * Two sources, because a tap arrives differently depending on what the app
   * was doing. Running: the listener. Not running at all: the tap *is* the
   * launch, and by the time anything mounts the event has been and gone, so
   * the response is read back instead. Both can describe the same tap, hence
   * the ref — opening the same job twice would leave a technician with two
   * screens to press Back through.
   */
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (id && handled.current === id) return;
      handled.current = id ?? null;

      const target = routeForPushData(response.notification.request.content.data);
      // A payload this build cannot read still opened the app, and that is
      // where it stops: better a technician looking at their day than at a
      // crash inside a tap handler.
      if (target) router.push(target);
    };

    open(Notifications.getLastNotificationResponse());
    // Whether or not it was handled, it must not be replayed on the next
    // launch as though the technician had just tapped it.
    Notifications.clearLastNotificationResponse();

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);

  return <>{children}</>;
}
