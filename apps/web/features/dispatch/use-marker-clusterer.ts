"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

type Marker = google.maps.marker.AdvancedMarkerElement;

/**
 * Groups job pins that sit on top of each other into a single numbered circle.
 *
 * A metro's worth of jobs lands in the same few streets, and overlapping pins
 * hide each other — the dispatcher cannot see, let alone click, what is
 * underneath. Zooming in splits a cluster back into its pins.
 *
 * Technicians are deliberately not clustered: there are few of them and they
 * mean something different from a job, so folding the two together would be a lie.
 */
export function useMarkerClusterer() {
  const map = useMap();
  const clusterer = useRef<MarkerClusterer | null>(null);
  const [markers, setMarkers] = useState<Record<string, Marker>>({});

  useEffect(() => {
    if (!map || clusterer.current) return;
    clusterer.current = new MarkerClusterer({ map });

    return () => {
      clusterer.current?.clearMarkers();
      clusterer.current = null;
    };
  }, [map]);

  useEffect(() => {
    const instance = clusterer.current;
    if (!instance) return;

    instance.clearMarkers();
    instance.addMarkers(Object.values(markers));
  }, [markers]);

  /** Hand each pin's marker to the clusterer as it mounts, and take it back on unmount. */
  const setMarkerRef = useCallback((marker: Marker | null, id: string) => {
    setMarkers((current) => {
      if (marker) {
        if (current[id] === marker) return current;
        return { ...current, [id]: marker };
      }

      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  return { setMarkerRef };
}
