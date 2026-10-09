"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  Clock,
  KeyRound,
  ListOrdered,
  Maximize2,
  MessageSquare,
  Mic,
  Minus,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { CallFlowNode, CallFlowNodeType, RingNode } from "@bitcrm/types";
import type { FlowStep } from "../flow-tree";
import { STEP_LABEL } from "../flow-graph";
import {
  CARD_H,
  CARD_W,
  layoutFlow,
  type LayoutLink,
  type LayoutNode,
} from "../flow-layout";

const ICONS: Record<CallFlowNodeType, typeof PhoneCall> = {
  say: MessageSquare,
  hours: Clock,
  menu: ListOrdered,
  ring: PhoneCall,
  voicemail: Mic,
  hangup: PhoneOff,
  ext: KeyRound,
};

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.4;
const ZOOM_STEP = 0.1;

/** The one-line detail under a card's title. */
function summarise(node: CallFlowNode, targetLabel: (node: RingNode) => string): string {
  switch (node.type) {
    case "say":
      return node.audioId ? "Plays a recording" : node.text || "Says nothing yet";
    case "hours": {
      const days = node.windows.length;
      return `${days} day${days === 1 ? "" : "s"} a week · ${node.timezone}`;
    }
    case "menu":
      return `${node.options.length} option${node.options.length === 1 ? "" : "s"}`;
    case "ring":
      // Workiz's Forward card: the number, or the name of what it rings.
      return targetLabel(node);
    case "voicemail":
      return `Records up to ${node.maxSeconds}s`;
    case "hangup":
      return node.text || "Ends the call";
    case "ext":
      return `Job code + PIN · ${node.repeats} attempt${node.repeats === 1 ? "" : "s"}`;
  }
}

/**
 * The flow, drawn as a map of the call.
 *
 * The picture is the whole point: a dispatcher who has never opened this
 * before can see where a 2am caller ends up without reading a single field.
 * So the canvas shows structure and nothing else — every setting lives in the
 * side panel, and the only things you can do here are press a `+` to add a
 * step or press a card to open it.
 *
 * Layout is not computed here; `flow-layout` does that, and does it without a
 * DOM so the arithmetic can be tested.
 */
export function FlowCanvas({
  steps,
  targetLabel,
  numbers,
  selectedId,
  onSelect,
  onSelectEntry,
  onAdd,
}: {
  steps: FlowStep[];
  /** What a Forward card says it rings — a name or a number (`ringTargetLabel`). */
  targetLabel: (node: RingNode) => string;
  /** Shown on the incoming-call card — the numbers that enter this flow. */
  numbers: string[];
  selectedId?: string;
  onSelect: (node: LayoutNode) => void;
  onSelectEntry: () => void;
  onAdd: (path: string[], index: number) => void;
}) {
  const layout = layoutFlow(steps);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const centred = useRef(false);

  /** Sit the flow under the top of the viewport, centred on its trunk. */
  const centre = useCallback(
    (scale: number) => {
      const box = viewportRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      setOffset({ x: box.width / 2 - (layout.width / 2) * scale, y: 24 });
    },
    [layout.width],
  );

  // Only on first paint: re-centring on every edit would yank the canvas out
  // from under somebody who had scrolled to a branch.
  useLayoutEffect(() => {
    if (centred.current) return;
    centred.current = true;
    centre(1);
  }, [centre]);

  const fit = () => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const next = Math.min(
      1,
      Math.max(
        MIN_ZOOM,
        Math.min((box.width - 64) / layout.width, (box.height - 64) / layout.height),
      ),
    );
    setZoom(next);
    setOffset({
      x: box.width / 2 - (layout.width / 2) * next,
      y: Math.max(24, box.height / 2 - (layout.height / 2) * next),
    });
  };

  const nudgeZoom = (delta: number) =>
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 10) / 10)));

  // Dragging the background moves the plane. Cards and buttons stop the event,
  // so pressing one never starts a pan.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    setPanning(true);
    const move = (ev: PointerEvent) =>
      setOffset({ x: ev.clientX - start.x, y: ev.clientY - start.y });
    const up = () => {
      setPanning(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={viewportRef}
      data-testid="flow-canvas"
      onPointerDown={onPointerDown}
      // Workiz's react-flow pane (pg_settings_phone_wz_builder_canvas): #f3f4f5, a one-off.
      className={cn(
        "relative flex-1 overflow-hidden bg-[#f3f4f5]",
        panning ? "cursor-grabbing" : "cursor-grab",
      )}
    >
      <div
        className="absolute origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          // The dot grid travels with the flow, so panning reads as moving the
          // paper rather than the camera.
          // react-flow's dots: 1px #c4c4c4 every 16px.
          backgroundImage: "radial-gradient(circle, #c4c4c4 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        <Links links={layout.links} />

        {layout.links.map((link) =>
          link.label ? (
            <span
              key={`${link.id}-label`}
              className="absolute -translate-x-1/2 -translate-y-1/2 bg-[#f3f4f5] px-1.5 text-xs leading-4 tracking-[0.4px] whitespace-nowrap text-wz-strong"
              style={labelPosition(link)}
            >
              {link.label}
            </span>
          ) : null,
        )}

        {layout.links.map((link) =>
          link.plus ? (
            <button
              key={`${link.id}-plus`}
              type="button"
              aria-label="Add a step"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onAdd(link.plus!.path, link.plus!.index)}
              // Workiz's DefaultEdge "+": a 28px white circle, 1px dashed ink.
              className="absolute grid size-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-dashed border-[#3b4c53] bg-white text-[#3b4c53] transition-colors hover:border-solid hover:bg-wz-secondary-hover"
              style={{ left: link.plus.x, top: link.plus.y }}
            >
              <Plus className="size-3.5" />
            </button>
          ) : null,
        )}

        {layout.nodes.map((node) =>
          node.kind === "entry" ? (
            <Card
              key={node.id}
              node={node}
              icon={PhoneIncoming}
              title="Incoming call"
              detail={
                numbers.length
                  ? `To: ${numbers.map(formatPhone).join(", ")}`
                  : "No number assigned yet"
              }
              ariaLabel="Incoming call"
              onSelect={onSelectEntry}
            />
          ) : (
            <Card
              key={node.id}
              node={node}
              icon={ICONS[node.step!.node.type]}
              title={STEP_LABEL[node.step!.node.type]}
              detail={summarise(node.step!.node, targetLabel)}
              // The detail rides along because a flow can hold three
              // greetings, and "Edit Say something" three times tells a screen
              // reader nothing about which one is which.
              ariaLabel={`Edit ${STEP_LABEL[node.step!.node.type]} — ${summarise(node.step!.node, targetLabel)}`}
              selected={selectedId === node.id}
              onSelect={() => onSelect(node)}
            />
          ),
        )}
      </div>

      {/* react-flow's controls: 26×27 buttons, #fefefe, 1px #eee rules, 0 0 2px 1px rgba(0,0,0,.08). */}
      <div className="absolute bottom-1 left-2.5 flex flex-col shadow-[0_0_2px_1px_rgba(0,0,0,0.08)]">
        <ZoomButton label="Zoom in" onClick={() => nudgeZoom(ZOOM_STEP)}>
          <Plus className="size-4" />
        </ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => nudgeZoom(-ZOOM_STEP)}>
          <Minus className="size-4" />
        </ZoomButton>
        <ZoomButton label="Fit the flow on screen" onClick={fit}>
          <Maximize2 className="size-4" />
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="grid h-[27px] w-[26px] cursor-pointer place-items-center rounded-[2px] border-b border-[#eeeeee] bg-[#fefefe] text-foreground hover:bg-[#f4f4f4] [&_svg]:size-3"
    >
      {children}
    </button>
  );
}

/**
 * Every line at once, in one SVG under the cards. A dot at each end is what
 * makes a line read as plugged into the card rather than passing behind it.
 */
function Links({ links }: { links: LayoutLink[] }) {
  return (
    <svg
      // react-flow's edges: 1px #b1b1b7; its handles: 8px #555 dots ringed in white.
      className="pointer-events-none absolute inset-0 size-full text-[#b1b1b7]"
      aria-hidden
    >
      {links.map((link) => {
        const first = link.points[0];
        const last = link.points[link.points.length - 1];
        return (
          <g key={link.id}>
            <polyline
              points={link.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
            />
            <circle cx={first.x} cy={first.y} r={4} fill="#555555" stroke="#ffffff" strokeWidth={1} />
            <circle cx={last.x} cy={last.y} r={4} fill="#555555" stroke="#ffffff" strokeWidth={1} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A branch's name goes at the corner its line turns at — reading "Open" then
 * following the line down is how somebody traces a path. A branch that runs
 * straight down has no corner, so its name sits on the line itself.
 */
function labelPosition(link: LayoutLink): { left: number; top: number } {
  const corner = link.points.length > 2 ? link.points[1] : undefined;
  if (corner) return { left: corner.x, top: corner.y - 14 };
  const [from, to] = [link.points[0], link.points[link.points.length - 1]];
  return { left: from.x, top: (from.y + to.y) / 2 };
}

function Card({
  node,
  icon: Icon,
  title,
  detail,
  ariaLabel,
  selected,
  onSelect,
}: {
  node: LayoutNode;
  icon: typeof PhoneCall;
  title: string;
  detail: string;
  ariaLabel: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onSelect}
      style={{ left: node.x - CARD_W / 2, top: node.y, width: CARD_W, height: CARD_H }}
      // Workiz's DefaultBlock (pg_settings_phone_wz_builder_canvas): 210×77
      // white, 8px corners, 0 0 20px rgba(0,0,0,.15); the glyph and 13px 600
      // title, the 11px/16px rgba(59,76,83,.7) detail 10px under it.
      className={cn(
        "absolute flex cursor-pointer flex-col items-center justify-center rounded-[8px] bg-white px-4 text-center shadow-[0_0_20px_rgba(0,0,0,0.15)] transition-shadow outline-none hover:shadow-[0_0_20px_rgba(0,0,0,0.25)] focus-visible:ring-2 focus-visible:ring-wz-focus",
        selected && "ring-2 ring-wz-focus",
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-[#3a4b52]" strokeWidth={1.5} />
        <span className="text-[13px] leading-5 font-semibold tracking-[0.4px] text-[#3a4b52]">{title}</span>
      </span>
      <span className="mt-2.5 line-clamp-1 w-full px-[5px] text-[11px] leading-4 tracking-[0.4px] text-[rgba(59,76,83,0.7)]">
        {detail}
      </span>
    </button>
  );
}
