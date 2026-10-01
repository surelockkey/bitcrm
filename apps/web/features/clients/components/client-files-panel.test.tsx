import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { useFilePreviewStore } from "@/features/files/preview-store";
import type { ContactFileRow } from "@/features/deals/attachments-api";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ClientFilesPanel } from "./client-files-panel";

const file = (over: Partial<ContactFileRow>): ContactFileRow => ({
  id: "f1",
  contactId: "c1",
  fileName: "front-door.jpg",
  contentType: "image/jpeg",
  size: 245_000,
  uploadedBy: "u1",
  uploadedAt: "2026-09-12T10:00:00",
  ...over,
});

const PAGE_1: ContactFileRow[] = [
  file({ id: "f-job-photo", dealId: "d1", dealNumber: "NU8GUR" }),
  file({ id: "f-client-photo", fileName: "gate.png", contentType: "image/png", uploadedAt: "2026-09-10T10:00:00" }),
  file({ id: "f-job-pdf", dealId: "d2", dealNumber: "SWD42X", fileName: "invoice.pdf", contentType: "application/pdf", size: 5678, uploadedAt: "2026-08-20T10:00:00" }),
  file({ id: "f-client-doc", fileName: "contract.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 2_300_000, uploadedAt: "2026-08-02T10:00:00" }),
];

describe("ClientFilesPanel — Workiz's Files rail", () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];

  beforeEach(() => {
    calls.length = 0;
    useFilePreviewStore.getState().close();
    server.use(
      http.get("*/deals/attachments/by-contact/c1", ({ request }) => {
        const url = new URL(request.url);
        calls.push({ method: "GET", url: url.pathname.slice(url.pathname.indexOf("/deals/")) + url.search });
        if (url.searchParams.get("cursor") === "page-2") {
          return HttpResponse.json({ success: true, data: [file({ id: "f-old", fileName: "old-key.pdf", contentType: "application/pdf", uploadedAt: "2026-05-01T10:00:00" })], pagination: { count: 1 } });
        }
        return HttpResponse.json({ success: true, data: PAGE_1, pagination: { count: PAGE_1.length, nextCursor: "page-2" } });
      }),
      http.get("*/deals/:dealId/attachments/:attachmentId", ({ params }) =>
        HttpResponse.json({ success: true, data: { downloadUrl: `https://s3.example/job/${params.dealId}/${params.attachmentId}` } }),
      ),
      http.get("*/deals/contacts/c1/attachments/:attachmentId", ({ params }) =>
        HttpResponse.json({ success: true, data: { downloadUrl: `https://s3.example/client/${params.attachmentId}` } }),
      ),
      http.post("*/deals/contacts/c1/attachments", async ({ request }) => {
        const body = await request.json();
        calls.push({ method: "POST", url: "/deals/contacts/c1/attachments", body });
        return HttpResponse.json({ success: true, data: { id: "f-new", uploadUrl: "https://s3.example/put/f-new", s3Key: "k", headers: { "Content-Type": "image/png", "x-amz-server-side-encryption": "aws:kms" } } });
      }),
      http.put("https://s3.example/put/f-new", ({ request }) => {
        calls.push({ method: "PUT", url: request.url, body: Object.fromEntries(request.headers.entries()) });
        return new HttpResponse(null, { status: 200 });
      }),
      http.delete("*/deals/contacts/c1/attachments/:attachmentId", ({ params }) => {
        calls.push({ method: "DELETE", url: `/deals/contacts/c1/attachments/${params.attachmentId}` });
        return HttpResponse.json({ success: true, data: null });
      }),
    );
  });

  const renderPanel = async (props: Partial<React.ComponentProps<typeof ClientFilesPanel>> = {}) => {
    const r = renderWithClient(<ClientFilesPanel contactId="c1" canEdit open onOpenChange={vi.fn()} {...props} />);
    const dialog = await screen.findByRole("dialog", { name: "Files" });
    await within(dialog).findByText("invoice.pdf");
    return { ...r, dialog };
  };

  it("shows every file by month: photos as a thumbnail grid with presigned sources, documents as rows with size, job files naming their job", async () => {
    const { dialog } = await renderPanel();
    expect(calls[0].url).toBe("/deals/attachments/by-contact/c1?limit=60");
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["September 2026", "August 2026"]);

    const grid = within(dialog).getByTestId("media-grid-September 2026");
    expect(grid).toHaveClass("grid-cols-3");
    const jobThumb = await within(grid).findByRole("img", { name: "front-door.jpg" });
    expect(jobThumb).toHaveAttribute("src", "https://s3.example/job/d1/f-job-photo");
    expect(await within(grid).findByRole("img", { name: "gate.png" })).toHaveAttribute("src", "https://s3.example/client/f-client-photo");
    expect(within(grid).getByRole("link", { name: "NU8GUR" })).toHaveAttribute("href", "/deals/d1");

    const docs = within(dialog).getAllByTestId("file-row");
    expect(docs.map((d) => d.textContent)).toEqual([expect.stringContaining("invoice.pdf"), expect.stringContaining("contract.docx")]);
    expect(docs[0]).toHaveTextContent("6 KB");
    expect(within(docs[0]).getByRole("link", { name: "SWD42X" })).toHaveAttribute("href", "/deals/d2");
    expect(docs[1]).toHaveTextContent("2.2 MB");
  });

  it("splits All / Media / Documents, Media being images and video", async () => {
    const { dialog } = await renderPanel();
    expect(within(dialog).getAllByRole("tab").map((t) => t.textContent)).toEqual(["All", "Media", "Documents"]);
    await userEvent.click(within(dialog).getByRole("tab", { name: "Media" }));
    expect(within(dialog).queryByText("invoice.pdf")).toBeNull();
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["September 2026"]);
    await userEvent.click(within(dialog).getByRole("tab", { name: "Documents" }));
    expect(within(dialog).queryByTestId(/media-grid/)).toBeNull();
    expect(within(dialog).getAllByTestId("file-row")).toHaveLength(2);
  });

  it("a thumbnail opens the shared file preview; Delete is offered on client files only", async () => {
    const { dialog } = await renderPanel();
    await userEvent.click(await within(dialog).findByRole("button", { name: "Open gate.png" }));
    expect(useFilePreviewStore.getState().file?.name).toBe("gate.png");
    expect(await useFilePreviewStore.getState().file?.load()).toBe("https://s3.example/client/f-client-photo");

    expect(within(dialog).queryByRole("button", { name: "Delete front-door.jpg" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete invoice.pdf" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Download invoice.pdf" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete contract.docx" }));
    await waitFor(() => expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/deals/contacts/c1/attachments/f-client-doc"));
  });

  it("uploads a client file through the presign + PUT flow, replaying the signed headers", async () => {
    const { dialog } = await renderPanel();
    const input = within(dialog).getByTestId("client-file-input") as HTMLInputElement;
    expect(input.accept).toBe("image/png,image/jpeg,image/webp,image/heic,application/pdf");
    await userEvent.upload(input, new File(["png-bytes"], "side-gate.png", { type: "image/png" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")).toBeTruthy());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ fileName: "side-gate.png", contentType: "image/png", size: 9 });
    expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ "x-amz-server-side-encryption": "aws:kms" });
  });

  it("hides upload and delete from a reader without contacts.edit", async () => {
    const { dialog } = await renderPanel({ canEdit: false });
    expect(within(dialog).queryByRole("button", { name: "Upload file" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Delete / })).toBeNull();
  });

  it("loads the next page by cursor", async () => {
    const { dialog } = await renderPanel();
    await userEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    expect(await within(dialog).findByText("old-key.pdf")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual(["/deals/attachments/by-contact/c1?limit=60", "/deals/attachments/by-contact/c1?limit=60&cursor=page-2"]);
  });
});
