"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { cx } from "./lib";

/**
 * A signature canvas (Workiz "Add your signature" / the mobile app's
 * Signatures +): draw with mouse, finger or pen, Clear to start over. Reports
 * a PNG data URL after every stroke and `null` while empty — the parent
 * decides what to do with it (the portal approves an estimate, the office
 * records an in-person signature).
 */
export function SignaturePad({
  onChange,
  disabled,
  className,
  height = 160,
}: {
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
  className?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Backing store at device resolution so the PNG is crisp on phones.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1f2937";
    onChangeRef.current(null);
  }, [height]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A tap is a dot, not nothing.
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    setEmpty(false);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onChangeRef.current(e.currentTarget.toDataURL("image/png"));
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChangeRef.current(null);
  }, []);

  return (
    <div className={cx("space-y-2", className)}>
      <div className="relative rounded-lg border bg-white">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Sign here"
          style={{ height, width: "100%", touchAction: "none", display: "block" }}
          className={cx("rounded-lg", disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair")}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {empty ? (
          <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-muted-foreground">
            Sign here
          </span>
        ) : null}
        <span className="pointer-events-none absolute inset-x-4 bottom-10 border-b border-dashed border-muted-foreground/40" />
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={disabled || empty}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Trash2 className="size-3.5" aria-hidden /> Clear
      </button>
    </div>
  );
}
