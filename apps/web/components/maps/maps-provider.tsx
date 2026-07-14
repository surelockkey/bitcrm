"use client";

import type { ReactNode } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { env } from "@/lib/env";

/**
 * Loads the Google Maps JS SDK for whatever is inside.
 *
 * With no key it renders the children untouched rather than failing: address
 * fields fall back to plain typing and the app stays usable. Maps is only
 * fetched where it is actually needed (the dispatch map, the address fields),
 * not on every page.
 */
export function MapsProvider({ children }: { children: ReactNode }) {
  if (!env.googleMapsApiKey) return <>{children}</>;

  return (
    <APIProvider apiKey={env.googleMapsApiKey} libraries={["places"]}>
      {children}
    </APIProvider>
  );
}
