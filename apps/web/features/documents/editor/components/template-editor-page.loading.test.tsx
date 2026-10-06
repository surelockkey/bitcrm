import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { createTemplateContent } from "@bitcrm/document-renderer";
import type { DocumentTemplateContent } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TemplateEditorPage } from "./template-editor-page";

/**
 * The template editor opens on a page that stays put.
 *
 * The canvas drew its paper at full size and only then measured the room it
 * had and zoomed to fit, so every section — header, signature, footer —
 * shrank and slid in the frame after the editor appeared (CLS 0.059 on the
 * dev site). And what the paper prints came after it: the company's logo
 * once the companies answered, an uploaded picture once its address had been
 * asked for — which the page only did after the template was in.
 *
 * Now the paper is measured before it is first painted, and the editor waits
 * behind its skeleton for the company and the pictures it shows.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/documents/tpl-1",
  useSearchParams: () => new URLSearchParams(),
}));

const me = { id: "u-admin", firstName: "Ada", lastName: "Admin", email: "ada@example.com", roleId: "role-admin" };

/** The classic invoice with an uploaded picture added to its body. */
function content(): DocumentTemplateContent {
  const c = createTemplateContent("invoice", "classic");
  c.body = [
    ...c.body,
    { id: "row-pic", columns: [{ id: "col-pic", span: 12, blocks: [{ id: "blk-pic", type: "image", assetId: "asset-pic", widthPercent: 50 }] }] },
  ] as DocumentTemplateContent["body"];
  return c;
}

const template = () => ({
  id: "tpl-1",
  name: "House invoice",
  kind: "invoice",
  isDefault: true,
  version: 1,
  createdBy: "u-admin",
  createdAt: "",
  updatedAt: "",
  ...content(),
});

const company = {
  id: "bp-1",
  name: "Northside Locks",
  isDefault: true,
  active: true,
  logoUrl: "https://cdn.example.com/northside-logo.png",
  defaultPaymentTerms: "cash",
  dueDateBasis: "invoice_created",
};

/** The width the canvas is given in the browser — jsdom lays nothing out. */
const CANVAS_WIDTH = 600;

let server: FakeServer;
const realRect = HTMLElement.prototype.getBoundingClientRect;
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (!this.classList.contains("doc-canvas")) return realRect.call(this);
    const box = { x: 0, y: 0, top: 0, left: 0, width: CANVAS_WIDTH, right: CANVAS_WIDTH, height: 900, bottom: 900 };
    return { ...box, toJSON: () => box } as DOMRect;
  };
  // A desktop: the three-pane editor, not the phone preview.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 1024px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  HTMLElement.prototype.getBoundingClientRect = realRect;
  window.matchMedia = realMatchMedia;
});

const editorUp = () => !!screen.queryByRole("button", { name: "Rename template House invoice" });

describe("TemplateEditorPage — loading", () => {
  it("paints the paper at its fitted size, with the logo and the pictures, in the editor's first frame", async () => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: 10 },
      { match: /\/billing\/templates\/tpl-1$/, reply: () => template(), delayMs: 20 },
      // The order the browser saw: the companies after the template.
      { match: /\/billing\/business-profiles$/, reply: () => [company], delayMs: 80 },
      { match: /\/billing\/assets\/asset-pic\/url$/, reply: () => ({ url: "https://cdn.example.com/pic.png" }), delayMs: 20 },
      { match: /\/deals\/job-types$/, reply: () => [] },
      { match: /\/deals\/service-areas$/, reply: () => [] },
    ]);
    const first = watchFirstFrame(editorUp, () => {
      const paper = document.querySelector<HTMLElement>(".doc-canvas .paper");
      return {
        zoom: paper?.style.getPropertyValue("zoom") ?? null,
        logo: !!document.querySelector(".doc-canvas img.logo"),
        picture: !!document.querySelector('.doc-canvas img.img[src="https://cdn.example.com/pic.png"]'),
      };
    });

    renderWithClient(
      <TooltipProvider>
        <TemplateEditorPage templateId="tpl-1" />
      </TooltipProvider>,
    );
    await screen.findByRole("button", { name: "Rename template House invoice" });
    await settle();
    first.stop();

    // Letter paper is 816px wide; the canvas keeps 120px for the section labels.
    const fit = String(Math.min(1, (CANVAS_WIDTH - 120) / 816));
    expect(first.frame()).toEqual({ zoom: fit, logo: true, picture: true });
    expect(duplicates(server.requests)).toEqual([]);
  });
});
