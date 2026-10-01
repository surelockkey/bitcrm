import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import type { ContactNote } from "../notes-types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({ map: new Map([["u-betty", { id: "u-betty", firstName: "Betty", lastName: "Platinum" }]]), users: [], isLoading: false }),
}));

import { ClientNotesPanel } from "./client-notes-panel";

const note = (over: Partial<ContactNote>): ContactNote => ({
  id: "n1",
  contactId: "c1",
  note: "Net 45 client. Tax exempt.",
  actorId: "u-betty",
  actorName: "betty@slk.com",
  pinned: false,
  createdAt: "2025-07-24T18:19:00",
  updatedAt: "2025-07-24T18:19:00",
  ...over,
});

const LONG = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a long note about the client's gate codes.`).join("\n");

describe("ClientNotesPanel — Workiz's Notes rail", () => {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let notes: ContactNote[];

  beforeEach(() => {
    calls.length = 0;
    notes = [
      note({ id: "n1" }),
      note({ id: "n2", note: LONG, actorId: "u-unknown", actorName: "Piper CSR", createdAt: "2025-07-02T09:00:00", updatedAt: "2025-07-02T09:00:00" }),
      note({ id: "n3", note: "Pinned: call before arriving", pinned: true, createdAt: "2025-03-01T09:00:00", updatedAt: "2025-03-01T09:00:00" }),
      note({ id: "n4", note: "June visit went fine", createdAt: "2025-06-30T09:00:00", updatedAt: "2025-06-30T09:00:00" }),
    ];
    server.use(
      http.get("*/crm/contacts/c1/notes", ({ request }) => {
        const url = new URL(request.url);
        calls.push({ method: "GET", url: url.pathname.slice(url.pathname.indexOf("/crm/")) + url.search });
        if (url.searchParams.get("cursor") === "page-2") {
          return HttpResponse.json({ success: true, data: [note({ id: "n5", note: "From the second page", createdAt: "2025-01-05T09:00:00" })], pagination: { count: 1 } });
        }
        return HttpResponse.json({ success: true, data: notes, pagination: { count: notes.length, nextCursor: "page-2" }, notesCount: 5 });
      }),
      http.post("*/crm/contacts/c1/notes", async ({ request }) => {
        const body = (await request.json()) as { note: string };
        calls.push({ method: "POST", url: "/crm/contacts/c1/notes", body });
        const created = note({ id: "n-new", note: body.note, createdAt: "2025-10-01T12:00:00", updatedAt: "2025-10-01T12:00:00" });
        notes = [created, ...notes];
        return HttpResponse.json({ success: true, data: created });
      }),
      http.patch("*/crm/contacts/c1/notes/:noteId", async ({ request, params }) => {
        const body = (await request.json()) as Partial<ContactNote>;
        calls.push({ method: "PATCH", url: `/crm/contacts/c1/notes/${params.noteId}`, body });
        notes = notes.map((n) => (n.id === params.noteId ? { ...n, ...body } : n));
        return HttpResponse.json({ success: true, data: notes.find((n) => n.id === params.noteId) });
      }),
      http.delete("*/crm/contacts/c1/notes/:noteId", ({ params }) => {
        calls.push({ method: "DELETE", url: `/crm/contacts/c1/notes/${params.noteId}` });
        notes = notes.filter((n) => n.id !== params.noteId);
        return HttpResponse.json({ success: true, data: { deleted: true } });
      }),
    );
  });

  const renderPanel = async (props: Partial<React.ComponentProps<typeof ClientNotesPanel>> = {}) => {
    const r = renderWithClient(
      <ClientNotesPanel contactId="c1" description="Legacy description from the client form." canEdit open onOpenChange={vi.fn()} {...props} />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Notes" });
    await within(dialog).findByText("Net 45 client. Tax exempt.");
    return { ...r, dialog };
  };

  it("lists the notes pinned first, then by month, each with author, Workiz's stamp and the legacy description on top", async () => {
    const { dialog } = await renderPanel();
    const headings = within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Pinned", "July 2025", "June 2025"]);

    const cards = within(dialog).getAllByTestId("note-card");
    expect(cards[0]).toHaveTextContent("Description");
    expect(cards[0]).toHaveTextContent("Legacy description from the client form.");
    expect(within(cards[0]).queryByRole("button", { name: /Delete note/ })).toBeNull();
    expect(cards[1]).toHaveTextContent("Pinned: call before arriving");
    expect(within(cards[1]).getByRole("button", { name: "Unpin note" })).toBeInTheDocument();
    // The author comes from the user directory when it knows the id, else the stored name.
    expect(cards[2]).toHaveTextContent("Betty Platinum");
    expect(cards[2]).toHaveTextContent("Jul 24 2025 • 6:19 PM");
    expect(within(cards[2]).getByText("BP")).toBeInTheDocument();
    expect(cards[3]).toHaveTextContent("Piper CSR");
  });

  it("clips a long note behind Show more", async () => {
    const { dialog } = await renderPanel();
    const long = within(dialog).getAllByTestId("note-card")[3];
    expect(within(long).getByTestId("note-text")).toHaveClass("line-clamp-4");
    await userEvent.click(within(long).getByRole("button", { name: "Show more" }));
    expect(within(long).getByTestId("note-text")).not.toHaveClass("line-clamp-4");
    expect(within(long).getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  it("adds a note from the composer at the top and shows it", async () => {
    const { dialog } = await renderPanel();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add note" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "New note" }), "Gate code 4421");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ note: "Gate code 4421" }));
    expect(await within(dialog).findByText("Gate code 4421")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: "New note" })).toBeNull();
  });

  it("pins, edits and deletes a note through the CRM routes", async () => {
    const { dialog } = await renderPanel();
    const card = within(dialog).getAllByTestId("note-card")[2];
    await userEvent.click(within(card).getByRole("button", { name: "Pin note" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")).toEqual({ method: "PATCH", url: "/crm/contacts/c1/notes/n1", body: { pinned: true } }));
    // Re-sorted: the newly pinned note joins the Pinned group.
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Notes" })).getAllByTestId("note-card")[1]).toHaveTextContent("Net 45 client. Tax exempt."));

    const pinned = within(dialog).getAllByTestId("note-card")[1];
    await userEvent.click(within(pinned).getByRole("button", { name: "Edit note" }));
    const box = within(pinned).getByRole("textbox", { name: "Edit note" });
    await userEvent.clear(box);
    await userEvent.type(box, "Net 60 now");
    await userEvent.click(within(pinned).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ note: "Net 60 now" }));
    expect(await within(dialog).findByText("Net 60 now")).toBeInTheDocument();

    await userEvent.click(within(within(dialog).getAllByTestId("note-card")[1]).getByRole("button", { name: "Delete note" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/crm/contacts/c1/notes/n1"));
    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "Notes" })).queryByText("Net 60 now")).toBeNull());
  });

  it("hides the composer, pin, edit and delete from a reader without contacts.edit", async () => {
    const { dialog } = await renderPanel({ canEdit: false });
    expect(within(dialog).queryByRole("button", { name: "Add note" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Pin note|Unpin note/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Edit note" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete note" })).toBeNull();
  });

  it("loads the next page by cursor", async () => {
    const { dialog } = await renderPanel();
    await userEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    expect(await within(dialog).findByText("From the second page")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual(["/crm/contacts/c1/notes?limit=30", "/crm/contacts/c1/notes?limit=30&cursor=page-2"]);
  });
});
