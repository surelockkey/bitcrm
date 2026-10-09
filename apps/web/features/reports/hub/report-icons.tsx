import { createLucideIcon } from "lucide-react";

/*
 * Two of Workiz's hub glyphs (Linearicons, rep_hub_wz_01_default) that Lucide
 * has no match for, drawn on Lucide's 24px grid so they take the same stroke
 * as the rest.
 */

/**
 * The Jobs card's `lnr-hammer-wrench`: a hammer (head top-left, handle down
 * to the right) crossed with Lucide's wrench (head top-right).
 */
export const HammerWrench = createLucideIcon("HammerWrench", [
  [
    "path",
    {
      d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
      key: "wrench",
    },
  ],
  ["path", { d: "M8.63 1.55 11.45 4.37 4.37 11.45 1.55 8.63Z", key: "hammer-head" }],
  ["path", { d: "M8.69 7.13 19.78 18.22A1.1 1.1 0 0 1 18.22 19.78L7.13 8.69", key: "hammer-handle" }],
]);

/**
 * The Estimates card's `lnr-paperclip` stands upright; Lucide's leans, so
 * this is Lucide's paperclip turned 45° (and a touch smaller to stay inside
 * the box).
 */
export const UprightPaperclip = createLucideIcon("UprightPaperclip", [
  [
    "path",
    {
      d: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
      transform: "translate(12 12) rotate(-45) scale(0.92) translate(-12 -12)",
      key: "paperclip",
    },
  ],
]);
