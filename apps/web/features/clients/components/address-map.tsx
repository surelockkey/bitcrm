"use client";

import { ExternalLink, Navigation } from "lucide-react";
import { AdvancedMarker, Map as GoogleMap, Marker } from "@vis.gl/react-google-maps";
import type { Address } from "@bitcrm/types";
import { MapsProvider } from "@/components/maps/maps-provider";
import { env } from "@/lib/env";
import { formatAddress } from "../lib";

/** The middle of the lower 48, for an address with no coordinates yet. */
const FALLBACK_CENTER = { lat: 39.5, lng: -98.35 };

const mapsSearchUrl = (a: Address) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(a))}`;
const directionsUrl = (a: Address) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(formatAddress(a))}`;

/**
 * Workiz's map in the Address panel: the address pinned, a "Maps" link into
 * Google Maps over the corner. Without a Google key the box says so instead
 * of pretending; the links still work.
 */
export function AddressMap({ address }: { address: Address }) {
  const point = address.lat !== undefined && address.lng !== undefined ? { lat: address.lat, lng: address.lng } : null;
  const hasStreet = !!address.street.trim();

  return (
    <div className="relative h-40 overflow-hidden rounded-md border bg-muted">
      {env.googleMapsApiKey ? (
        <MapsProvider>
          <GoogleMap
            mapId={env.googleMapsMapId || undefined}
            center={point ?? undefined}
            defaultCenter={point ?? FALLBACK_CENTER}
            defaultZoom={point ? 15 : 3}
            zoom={point ? 15 : undefined}
            gestureHandling="greedy"
            disableDefaultUI
            className="size-full"
          >
            {point ? env.googleMapsMapId ? <AdvancedMarker position={point} /> : <Marker position={point} /> : null}
          </GoogleMap>
        </MapsProvider>
      ) : (
        <div className="flex size-full items-center justify-center text-xs text-muted-foreground">Map needs a Google Maps key.</div>
      )}
      {hasStreet ? (
        <a
          href={mapsSearchUrl(address)}
          target="_blank"
          rel="noreferrer"
          aria-label="Maps"
          className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-brand shadow-sm hover:underline"
        >
          Maps <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

/** Workiz's "Get directions" row under the fields. */
export function GetDirections({ address }: { address: Address }) {
  if (!address.street.trim()) return null;
  return (
    <a
      href={directionsUrl(address)}
      target="_blank"
      rel="noreferrer"
      aria-label="Get directions"
      className="flex items-center justify-between border-y py-3 text-sm hover:text-brand"
    >
      <span className="inline-flex items-center gap-2">
        <Navigation className="size-4 text-muted-foreground" aria-hidden /> Get directions
      </span>
      <span aria-hidden>›</span>
    </a>
  );
}
