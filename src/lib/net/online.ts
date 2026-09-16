import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

/**
 * "Connected" for our purposes.
 *
 * `isInternetReachable` is the honest signal — a van parked under a bridge can
 * hold a cell connection that carries nothing. It is null while the probe is
 * still running, and treating that as offline would stall the first fetch after
 * launch, so an unknown reachability with a live connection counts as online.
 */
export function isOnline(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  if (!state.isConnected) return false;
  return state.isInternetReachable !== false;
}

/**
 * Hands react-query the phone's real connectivity, so queries pause instead of
 * failing when the signal goes, and resume on their own when it returns
 * (docs/ARCHITECTURE.md §2.2). Returns the unsubscribe.
 */
export function startOnlineMonitor(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(isOnline(state))),
  );
  return () => onlineManager.setEventListener(() => () => {});
}
