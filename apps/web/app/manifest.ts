import type { MetadataRoute } from "next";

/**
 * The web app manifest — what a phone needs before it will let a technician
 * keep BitCRM on their home screen.
 *
 * `standalone` is the point of it: tapped from the home screen the app opens
 * without the browser's address bar and back/forward chrome, which on a phone
 * is a third of the screen and two ways to lose your place mid-job.
 *
 * `start_url` is `/` rather than `/my-jobs`, because `/` already routes a
 * technician to their day and everyone else to the dashboard — one icon, the
 * right landing for whoever signed in.
 *
 * The colours are the app's own tokens (`--brand`, `--background`) resolved to
 * hex, since a manifest can't read CSS variables. Keep them in step with
 * `globals.css` if the palette moves.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BitCRM — field service",
    short_name: "BitCRM",
    description:
      "Jobs, clients and stock for the field: your day, your van, and the office in your pocket.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#2c63ed",
    categories: ["business", "productivity"],
    icons: [
      // From `public/`, not the `app/icon.png` convention: Next serves that one
      // at a hashed `/icon?…` URL, which a manifest cannot name. These are the
      // same artwork at the two sizes installers ask for.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops a maskable icon to whatever shape the launcher wears —
      // circle, squircle, teardrop — so it gets its own artwork: the logo on
      // an opaque canvas at two thirds of the width, comfortably inside the
      // 80% safe circle. Pointing this at the "any" icon, which bleeds to the
      // edges, cost the logo its edges on every round launcher.
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icons/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      // Long-pressing the home-screen icon jumps straight to the two pages a
      // technician opens; both fall back to a normal navigation elsewhere.
      { name: "My Jobs", short_name: "Jobs", url: "/my-jobs" },
      { name: "My Stock", short_name: "Stock", url: "/my-stock" },
    ],
  };
}
