"use client";

import { useEffect, useState } from "react";
import { Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { Undo2, Trash2, Maximize2, Minimize2 } from "lucide-react";
import type { GeoPoint } from "@bitcrm/types";
import { env } from "@/lib/env";
import { Button } from "@/components/ui/button";
import { MapsProvider } from "@/components/maps/maps-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ATLANTA = { lat: 33.749, lng: -84.388 };

/** Draws the in-progress polygon + a numbered marker per dropped dot. */
function PolygonOverlay({ vertices }: { vertices: GeoPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const poly = new google.maps.Polygon({
      map,
      paths: vertices,
      strokeColor: "#2563eb",
      strokeWeight: 2,
      fillColor: "#3b82f6",
      fillOpacity: 0.15,
    });
    const markers = vertices.map(
      (v, i) =>
        new google.maps.Marker({
          map,
          position: v,
          label: { text: String(i + 1), color: "#fff", fontSize: "11px" },
        }),
    );
    return () => {
      poly.setMap(null);
      markers.forEach((m) => m.setMap(null));
    };
  }, [map, vertices]);

  return null;
}

/** Controls row: undo / clear / expand. */
function Controls({
  count,
  onUndo,
  onClear,
  fullscreen,
  onToggleFullscreen,
}: {
  count: number;
  onUndo: () => void;
  onClear: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground">Click the map to add points ({count} placed).</p>
      <div className="flex gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1" disabled={count === 0} onClick={onUndo}>
          <Undo2 className="size-3.5" /> Undo
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1" disabled={count === 0} onClick={onClear}>
          <Trash2 className="size-3.5" /> Clear
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={onToggleFullscreen}>
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          {fullscreen ? "Exit" : "Expand"}
        </Button>
      </div>
    </div>
  );
}

/** The map surface itself (drawing polygon + markers). */
function MapCanvas({
  value,
  onChange,
  className,
}: {
  value: GeoPoint[];
  onChange: (v: GeoPoint[]) => void;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <GoogleMap
        mapId={env.googleMapsMapId || undefined}
        defaultCenter={value[0] ?? ATLANTA}
        defaultZoom={10}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        className="size-full"
        onClick={(e) => {
          const ll = e.detail.latLng;
          if (ll) onChange([...value, { lat: ll.lat, lng: ll.lng }]);
        }}
      >
        <PolygonOverlay vertices={value} />
      </GoogleMap>
    </div>
  );
}

/**
 * Click the map to drop ordered dots; they form the service-area polygon.
 * "Select on map by dots" from the spec. Degrades to a notice when no Maps key
 * is configured. Supports an expanded fullscreen view for precise drawing.
 */
export function PolygonMapEditor({
  value,
  onChange,
}: {
  value: GeoPoint[];
  onChange: (vertices: GeoPoint[]) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  if (!env.googleMapsApiKey) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        A Google Maps key is required to draw a polygon service area. Use ZIP codes instead,
        or set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>.
      </p>
    );
  }

  const controls = (
    <Controls
      count={value.length}
      onUndo={() => onChange(value.slice(0, -1))}
      onClear={() => onChange([])}
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen((f) => !f)}
    />
  );

  return (
    <MapsProvider>
      <div className="space-y-2">
        {controls}
        {/* Hide the inline map while expanded so only one map instance is live. */}
        {!fullscreen ? <MapCanvas value={value} onChange={onChange} className="h-72" /> : null}
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="flex h-[92vh] w-[95vw] max-w-none flex-col gap-3 sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Draw service area</DialogTitle>
          </DialogHeader>
          {controls}
          <MapCanvas value={value} onChange={onChange} className="min-h-0 flex-1" />
        </DialogContent>
      </Dialog>
    </MapsProvider>
  );
}
