"use client";

import { createContext, useContext } from "react";

/**
 * Whether the dashboard's opening bundle has settled. Until it has, a card
 * does not fetch on its own — the bundle is about to fill its cache — and
 * shows its skeleton, so every card fills at the same moment instead of one
 * by one. Outside the dashboard (a card on its own, a test) it is `true`.
 */
export const DashboardReady = createContext(true);

export const useDashboardReady = () => useContext(DashboardReady);
