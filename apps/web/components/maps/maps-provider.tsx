"use client";

import type { ReactNode } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { env } from "@/lib/env";

/**
 * The single Google Maps loader for the app.
 *
 * Everything that touches Maps — the dispatch map and the address autocomplete —
 * must load the API the same way. @vis.gl uses the modern `importLibrary`
 * bootstrap; mixing it with a hand-injected `maps/api/js` script makes Google
 * warn "included multiple times". @vis.gl dedupes across every APIProvider, so
 * nesting these is safe and still loads the API exactly once.
 *
 * With no key it renders children untouched — address fields degrade to plain
 * typing and the app stays usable.
 */
export function MapsProvider({ children }: { children: ReactNode }) {
  if (!env.googleMapsApiKey) return <>{children}</>;
  return <APIProvider apiKey={env.googleMapsApiKey}>{children}</APIProvider>;
}
