"use client";

import { useSyncExternalStore } from "react";
import {
  claimOwnership,
  isOwnerTab,
  onOwnershipChange,
} from "./tab-coordinator";

/**
 * Does this tab own the phone? Every tab calls it; exactly one gets `true`.
 * SSR renders as a follower, so nothing tries to touch a Device on the server.
 */
export function useTabOwner(): boolean {
  return useSyncExternalStore(
    (notify) => {
      claimOwnership();
      return onOwnershipChange(notify);
    },
    isOwnerTab,
    () => false,
  );
}
