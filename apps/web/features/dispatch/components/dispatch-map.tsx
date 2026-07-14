"use client";

import { useEffect } from "react";
// Aliased: the component would otherwise shadow the built-in Map type below.
import { Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import type { User } from "@bitcrm/types";
import { JobPin } from "./job-pin";
import { TechMarker } from "./tech-marker";
import type { LocatedDeal, TechnicianPosition } from "../lib";

/** Atlanta — the metro the platform serves; only used until real pins arrive. */
const FALLBACK_CENTER = { lat: 33.749, lng: -84.388 };

/** Frame the day's work instead of dumping the dispatcher at a default zoom. */
function FitToJobs({ deals }: { deals: LocatedDeal[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map || deals.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    for (const deal of deals) {
      bounds.extend({ lat: deal.address.lat, lng: deal.address.lng });
    }
    map.fitBounds(bounds, 64);

    // A single pin fits to maximum zoom, which is disorienting.
    if (deals.length === 1) map.setZoom(14);
  }, [map, deals]);

  return null;
}

export function DispatchMap({
  deals,
  technicians,
  userMap,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  label,
}: {
  deals: LocatedDeal[];
  technicians: TechnicianPosition[];
  userMap: Map<string, User>;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  label: (deal: LocatedDeal) => string;
}) {
  return (
    <GoogleMap
      mapId="bitcrm-dispatch"
      defaultCenter={FALLBACK_CENTER}
      defaultZoom={11}
      gestureHandling="greedy"
      disableDefaultUI={false}
      streetViewControl={false}
      mapTypeControl={false}
      className="size-full"
    >
      <FitToJobs deals={deals} />

      {deals.map((deal) => (
        <JobPin
          key={deal.id}
          deal={deal}
          label={label(deal)}
          hovered={hoveredId === deal.id}
          selected={selectedId === deal.id}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}

      {technicians.map((position) => {
        const user = userMap.get(position.userId);
        const name = user
          ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
          : "Technician";
        return (
          <TechMarker
            key={position.userId}
            position={position}
            name={name}
            hovered={hoveredId === position.userId}
            onHover={onHover}
          />
        );
      })}
    </GoogleMap>
  );
}
