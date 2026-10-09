"use client";

import { useEffect, type ReactNode } from "react";
// Aliased: the component would otherwise shadow the built-in Map type below.
import { Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import type { Deal, ServiceArea } from "@bitcrm/types";
import { env } from "@/lib/env";
import { JobPin } from "./job-pin";
import { TechMarker } from "./tech-marker";
import { ServiceAreaOverlay } from "./service-area-overlay";
import {
  techJobsToday,
  technicianAvailability,
  todayISO,
  type LocatedDeal,
  type TechnicianPosition,
} from "../lib";

/** Atlanta — the metro the platform serves; only used until real pins arrive. */
const FALLBACK_CENTER = { lat: 33.749, lng: -84.388 };

type Spot = { lat: number; lng: number };

/**
 * Frame what the map shows instead of dumping the dispatcher at a default
 * zoom — the jobs on the Jobs tab, the team on the Techs tab, as Workiz
 * frames each. Keyed on the spots themselves, so a poll that brings the same
 * pins back leaves the map where the dispatcher put it.
 */
function FitTo({ spots }: { spots: Spot[] }) {
  const map = useMap();
  const key = spots.map((s) => `${s.lat},${s.lng}`).join("|");

  useEffect(() => {
    if (!map || spots.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const s of spots) bounds.extend(s);
    map.fitBounds(bounds, 64);
    // A single pin fits to maximum zoom, which is disorienting.
    if (spots.length === 1) map.setZoom(14);
  }, [map, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Zoom level a selection pans to, if the map is further out than this. */
const SELECT_ZOOM = 15;

/** Re-centre (and zoom in) on the picked job or technician. */
function PanTo({
  target,
  nonce,
}: {
  target: Spot | null;
  /** Changes on every selection, so clicking the same item re-centres too. */
  nonce: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !target) return;
    map.panTo(target);
    // Pull in if we're zoomed out — a centred dot on a metro-wide view is
    // useless — but don't yank someone who's already zoomed in closer.
    if ((map.getZoom() ?? 0) < SELECT_ZOOM) map.setZoom(SELECT_ZOOM);
    // Keyed on the nonce so re-selecting the same marker still re-centres.
  }, [map, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/**
 * Workiz's map (pg_dispatch_wz_02): Google's map with only the fullscreen
 * and camera controls, a pin per job — no clusters, every pin drawn — and,
 * on the Techs tab, a pin per technician.
 */
export function DispatchMap({
  deals,
  allDeals,
  technicians,
  serviceAreas,
  fitTo,
  jobTechNames,
  techName,
  hoveredId,
  selectedId,
  panTo,
  panNonce,
  onHover,
  onSelect,
  jobCard,
  techCard,
}: {
  deals: LocatedDeal[];
  /** Every deal (not just the shown ones), for a technician's day. */
  allDeals: Deal[];
  technicians: TechnicianPosition[];
  /** Coverage polygons to draw underneath the pins; empty hides the layer. */
  serviceAreas: ServiceArea[];
  /** What the map frames when the set changes. */
  fitTo: "jobs" | "techs";
  jobTechNames: (deal: LocatedDeal) => string[];
  techName: (userId: string) => string;
  hoveredId: string | null;
  selectedId: string | null;
  /** When set, the map re-centres here — the picked job or technician. */
  panTo: Spot | null;
  /** Increments on every selection, so re-picking the same item re-centres. */
  panNonce: number;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** The picked job's card. */
  jobCard: (deal: LocatedDeal) => ReactNode;
  /** The picked technician's card. */
  techCard: (position: TechnicianPosition) => ReactNode;
}) {
  const today = todayISO();
  const spots: Spot[] =
    fitTo === "jobs" ? deals.map((d) => ({ lat: d.address.lat, lng: d.address.lng })) : technicians;
  return (
    <GoogleMap
      mapId={env.googleMapsMapId}
      defaultCenter={FALLBACK_CENTER}
      defaultZoom={11}
      gestureHandling="greedy"
      disableDefaultUI={false}
      streetViewControl={false}
      mapTypeControl={false}
      zoomControl={false}
      className="size-full"
    >
      <FitTo spots={spots} />
      <PanTo target={panTo} nonce={panNonce} />
      <ServiceAreaOverlay areas={serviceAreas} />

      {deals.map((deal) => (
        <JobPin
          key={deal.id}
          deal={deal}
          techNames={jobTechNames(deal)}
          hovered={hoveredId === deal.id}
          selected={selectedId === deal.id}
          onHover={onHover}
          onSelect={onSelect}
          card={selectedId === deal.id ? jobCard(deal) : null}
        />
      ))}

      {technicians.map((position) => (
        <TechMarker
          key={position.userId}
          position={position}
          name={techName(position.userId)}
          availability={technicianAvailability(techJobsToday(allDeals, position.userId, today), position)}
          hovered={hoveredId === position.userId}
          selected={selectedId === position.userId}
          onHover={onHover}
          onSelect={onSelect}
          card={selectedId === position.userId ? techCard(position) : null}
        />
      ))}
    </GoogleMap>
  );
}
