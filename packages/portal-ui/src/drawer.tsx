"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./lib";

/**
 * Workiz's right-hand drawer ("Sign & Pay"): full height, the title centred,
 * × on the right, a grey body. The whole screen on a phone.
 */
export function Drawer({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-60 flex justify-end bg-[#3b4b52]/45 font-sans text-[#3b4b52]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-full w-full flex-col bg-white shadow-[-8px_0_24px_rgba(59,75,82,0.18)] sm:max-w-[520px]">
        <header className="relative flex flex-none items-center justify-center px-12 pt-[max(1.25rem,env(safe-area-inset-top))] pb-3">
          <h2 className="truncate text-base font-medium">{title}</h2>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label="Close and go back"
            className="absolute top-1/2 right-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full hover:bg-[#f3f4f5] focus-visible:ring-2 focus-visible:ring-[#6aa8ee] focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>
        <div className={cx("min-h-0 flex-1 overflow-auto rounded-t-2xl bg-[#f3f4f5]", className)}>{children}</div>
      </div>
    </div>
  );
}

/** The numbered green dot of a step; a dark check once it is done (Workiz). */
export function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-7 flex-none items-center justify-center rounded-full text-sm font-semibold text-white",
        done ? "bg-[#3b4b52]" : "bg-[#50d58c]",
      )}
    >
      {done ? (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      ) : (
        n
      )}
    </span>
  );
}
