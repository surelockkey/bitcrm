import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./msw/server";

// jsdom lacks ResizeObserver / scrollIntoView — polyfill for cmdk / Radix.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
// jsdom lacks the Pointer Capture API — Radix Select calls it on open/select.
if (typeof Element !== "undefined" && !Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
// jsdom lacks elementFromPoint — input-otp (used by the auth OTP field) calls it
// from a timer, which would otherwise surface as an unhandled error and fail the
// whole run even though every test passes.
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

// jsdom lacks matchMedia — polyfill for components that read it (e.g. Sidebar).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

// next/font is compiled away by Next; under vitest its module is empty. The
// loaders a component calls (the Workiz item popups use Poppins) hand back a
// plain class instead.
vi.mock("next/font/google", () => {
  const font = () => ({ className: "", style: { fontFamily: "sans-serif" }, variable: "" });
  return { Poppins: font, Geist: font, Geist_Mono: font };
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());
