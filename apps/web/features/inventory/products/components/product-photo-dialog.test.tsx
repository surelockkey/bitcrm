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
  photoKey: "products/p1/a.jpg",
  thumbnailUrl: "https://cdn.test/p1-thumb.webp",
};

function serve(answer: { downloadUrl?: string; status?: number } = {}) {
  const asked: string[] = [];
  server.use(
    http.get("*/inventory/products/:id/photo", ({ params }) => {
      asked.push(`photo ${params.id}`);
      return answer.status
        ? HttpResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Product has no photo" } }, { status: answer.status })
        : HttpResponse.json({ success: true, data: { downloadUrl: answer.downloadUrl } });
    }),
    http.get("*/inventory/products/:id", ({ params }) => {
      asked.push(`item ${params.id}`);
      return HttpResponse.json({ success: true, data: row });
    }),
  );
  return asked;
}

function open(product: ProductWithMedia = row) {
  renderWithClient(<ProductPhotoDialog product={product} onOpenChange={vi.fn()} />);
  return screen.getByRole("dialog", { name: "Item" });
}

/** Workiz's "Item" popup: the photo whole, 500px wide, over the list. */
describe("ProductPhotoDialog", () => {
  it("shows the full photo — one request, straight to the photo", async () => {
    const asked = serve({ downloadUrl: "https://s3.test/p1.jpg" });
    const dialog = open();
    await waitFor(() =>
      expect(within(dialog).getByRole("img", { name: "Deadbolt" })).toHaveAttribute("src", "https://s3.test/p1.jpg"),
    );
    expect(asked).toEqual(["photo p1"]);
  });

  it("is titled Item, as in Workiz, and names the item for a screen reader", () => {
    serve({ downloadUrl: "https://s3.test/p1.jpg" });
    const dialog = open();
    expect(within(dialog).getByRole("heading", { name: "Item" })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription("Deadbolt");
    expect(dialog.className).toMatch(/sm:max-w-\[500px\]/);
  });

  // The popup must not grow when the photo arrives: the frame is square from the first frame.
  it("holds a square frame for the photo while it loads", () => {
    serve({ downloadUrl: "https://s3.test/p1.jpg" });
    const dialog = open();
    const frame = within(dialog).getByTestId("photo-frame");
    expect(frame.className).toMatch(/aspect-square/);
    expect(within(frame).queryByRole("img")).toBeNull();
  });

  it("says so when the photo can't be read", async () => {
    serve({ status: 404 });
    const dialog = open();
    await waitFor(() => expect(within(dialog).getByText("Couldn't load the photo.")).toBeInTheDocument());
  });

  it("is closed without an item", () => {
    renderWithClient(<ProductPhotoDialog product={null} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
