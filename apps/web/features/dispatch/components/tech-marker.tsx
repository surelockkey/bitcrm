"use client";

import { useRef, type ReactNode } from "react";
import { AdvancedMarker } from "@vis.gl/react-google-maps";
import { WzMapPin, wzPinInitials } from "@/components/workiz/map-pin";
import { scheduleColor } from "@/features/schedule/calendar";
import type { TechAvailability, TechnicianPosition } from "../lib";

const CARD_PRESS_MS = 1000;

/**
 * A technician on the map — Workiz's Techs tab draws them with the same pin
 * as a job, in their colour with their initials (pg_dispatch_wz_11_techs).
 * Ours: a spot we inferred (home, last job) or a fix going stale is drawn
 * faded, so a guess never reads as a measurement.
 */
export function TechMarker({
  position,
  name,
  availability,
  hovered,
  selected,
  onHover,
  onSelect,
  card,
}: {
  position: TechnicianPosition;
  name: string;
  availability: TechAvailability;
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  card?: ReactNode;
}) {
  const live = position.source === "live";
  const cardPressedAt = useRef(0);
  return (
    <AdvancedMarker
      position={{ lat: position.lat, lng: position.lng }}
      zIndex={selected ? 1100 : hovered ? 950 : live ? 8 : 5}
      onMouseEnter={() => onHover(position.userId)}
      onMouseLeave={() => onHover(null)}
      onClick={() => {
        if (Date.now() - cardPressedAt.current < CARD_PRESS_MS) return;
        onSelect(position.userId);
      }}
    >
      <div
        data-testid={`tech-marker-${position.userId}`}
        data-source={position.source}
        data-stale={position.stale ? "true" : "false"}
        data-availability={availability}
        data-hovered={hovered || selected ? "true" : "false"}
      >
        <WzMapPin
          color={scheduleColor(position.userId)}
          label={wzPinInitials(name)}
          name={name}
          tooltip={hovered && !selected}
          dim={!live || position.stale}
        >
          {selected && card ? (
            <div className="contents" onPointerDownCapture={() => (cardPressedAt.current = Date.now())}>
              {card}
            </div>
          ) : null}
        </WzMapPin>
      </div>
    </AdvancedMarker>
  );
}
