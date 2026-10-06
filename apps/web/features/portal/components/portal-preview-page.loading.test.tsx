import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { PortalView } from "@bitcrm/types";
import { duplicates, installFakeServer, renderWithClient, settle, watchFirstFrame, type FakeServer } from "@/test/page-load";

/**
 * The portal preview appears once, whole.
 *
 * The page went up with the business's logo still loading: an `<img>` with no
 * width until its bytes arrive, so a moment later the logo took its room and
 * shoved the business name beside it across (the browser's layout-shift
 * report named that header). Now the preview waits behind its skeleton for
 * the logo too, and the logo is drawn at its size in the first frame.
 */

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const LOGO = "https://files.test/logo.png";

const view: PortalView = {
  business: { name: "Sure Lock Key", logoUrl: LOGO },
  client: { firstName: "Jane", lastName: "Client" },
  invoices: [],
  estimates: [],
  proposals: [],
  jobs: [],
  payments: [],
  preview: true,
};

/** Logos the "browser" has loaded, and how the next one ends. */
const images = { loaded: new Set<string>(), outcome: "load" as "load" | "error" };

/** A browser image: loads (or fails) a beat after its `src` is set. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) {
    setTimeout(() => {
      if (images.outcome === "load") {
        images.loaded.add(url);
        this.onload?.();
      } else {
        this.onerror?.();
      }
    }, 80);
  }
}

let server: FakeServer;

const { PortalPreviewPage } = await import("./portal-preview-page");

const viewUp = () => !!screen.queryByText("Sure Lock Key");

beforeEach(() => {
  images.loaded.clear();
  images.outcome = "load";
  vi.stubGlobal("Image", FakeImage);
  server = installFakeServer([{ match: /\/billing\/portal-links\/c1\/preview$/, reply: () => view }]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortalPreviewPage — one load, not waves", () => {
  it("holds the skeleton until the business logo has loaded, so the name beside it never slides", async () => {
    const watch = watchFirstFrame(viewUp, () => ({ logoLoaded: images.loaded.has(LOGO) }));
    renderWithClient(<PortalPreviewPage contactId="c1" />);
    await screen.findByText("Sure Lock Key", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ logoLoaded: true });
  });

  it("a logo that fails to load does not hold the preview", async () => {
    images.outcome = "error";
    renderWithClient(<PortalPreviewPage contactId="c1" />);

    expect(await screen.findByText("Sure Lock Key", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("asks for the preview once", async () => {
    renderWithClient(<PortalPreviewPage contactId="c1" />);
    await screen.findByText("Sure Lock Key", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
