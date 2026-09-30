import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import type { ProductWithMedia } from "../lib";
import { ProductPhotoDialog } from "./product-photo-dialog";

const row: ProductWithMedia = {
  id: "p1",
  number: 1042,
  sku: "LOCK-001",
  name: "Deadbolt",
  category: "Locks",
  type: ProductType.PRODUCT,
  costCompany: 10,
  costTech: 18,
  priceClient: 45,
  serialTracking: false,
  minimumStockLevel: 5,
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  photoKey: "products/p1.jpg",
  thumbnailUrl: "https://cdn.test/p1-thumb.webp",
};

function serve({ photoUrl, downloadUrl }: { photoUrl?: string; downloadUrl?: string }) {
  const asked: string[] = [];
  server.use(
    http.get("*/inventory/products/:id", ({ params }) => {
      asked.push(`item ${params.id}`);
      return HttpResponse.json({ success: true, data: { ...row, thumbnailUrl: undefined, photoUrl } });
    }),
    http.get("*/inventory/products/:id/photo", ({ params }) => {
      asked.push(`photo ${params.id}`);
      return HttpResponse.json({ success: true, data: { downloadUrl } });
    }),
  );
  return asked;
}

function open() {
  const onOpenChange = vi.fn();
  renderWithClient(<ProductPhotoDialog product={row} onOpenChange={onOpenChange} />);
  return screen.getByRole("dialog", { name: "Deadbolt" });
}

describe("ProductPhotoDialog", () => {
  it("shows the full photo the item carries", async () => {
    const asked = serve({ photoUrl: "https://cdn.test/p1-full.jpg" });
    const dialog = open();
    await waitFor(() =>
      expect(within(dialog).getByRole("img", { name: "Deadbolt" })).toHaveAttribute("src", "https://cdn.test/p1-full.jpg"),
    );
    expect(asked).toEqual(["item p1"]);
  });

  it("falls back to the photo route when the server sends no photoUrl", async () => {
    serve({ downloadUrl: "https://s3.test/p1.jpg" });
    const dialog = open();
    await waitFor(() =>
      expect(within(dialog).getByRole("img", { name: "Deadbolt" })).toHaveAttribute("src", "https://s3.test/p1.jpg"),
    );
  });

  // The popup must not grow when the photo arrives: the frame is square from the first frame.
  it("holds a square frame for the photo while it loads", () => {
    serve({ photoUrl: "https://cdn.test/p1-full.jpg" });
    const dialog = open();
    const frame = within(dialog).getByTestId("photo-frame");
    expect(frame.className).toMatch(/aspect-square/);
    expect(within(frame).queryByRole("img")).toBeNull();
  });

  it("is closed without an item", () => {
    renderWithClient(<ProductPhotoDialog product={null} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
