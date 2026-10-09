import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ClientTagsField } from "./client-tags-field";

const TAGS = [
  { id: "t-platinum", name: "PLATINUM", color: "blue", priority: 0, active: true },
  { id: "t-taxfree", name: "tax free", color: "green", priority: 0, active: true },
  { id: "t-old", name: "Old", color: "slate", priority: 0, active: false },
];

describe("ClientTagsField — Workiz's tag chips and the Add tag popup", () => {
  const puts: unknown[] = [];
  const posts: unknown[] = [];

  beforeEach(() => {
    puts.length = 0;
    posts.length = 0;
    server.use(
      http.get("*/deals/client-tags", () => HttpResponse.json({ success: true, data: TAGS })),
      http.post("*/deals/client-tags", async ({ request }) => {
        const body = (await request.json()) as { name: string };
        posts.push(body);
        return HttpResponse.json({ success: true, data: { id: "t-new", name: body.name, color: "slate", priority: 0, active: true } });
      }),
      http.put("*/crm/contacts/c1", async ({ request }) => {
        const body = (await request.json()) as { tagIds: string[] };
        puts.push(body);
        return HttpResponse.json({ success: true, data: { id: "c1", tagIds: body.tagIds } });
      }),
    );
  });

  it("shows the client's tags as chips, each with a way off", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={["t-platinum"]} canEdit canCreate />);
    expect(await screen.findByText("PLATINUM")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove PLATINUM" }));
    await waitFor(() => expect(puts).toEqual([{ tagIds: [] }]));
  });

  // Workiz's tag editor (pg_contact_wz_269669_10_addtag_open): "Available tags (N)",
  // "+ Create new", "Search tags" with an order toggle, a checkbox per tag, Apply.
  it("Add tag opens Workiz's Available tags: a box per active tag the client lacks; Apply puts the ticked ones on", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={["t-platinum"]} canEdit canCreate />);
    await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));

    const editor = await screen.findByRole("dialog", { name: "Available tags (1)" });
    expect(within(editor).getByRole("checkbox", { name: "tax free" })).not.toBeChecked();
    expect(within(editor).queryByRole("checkbox", { name: "PLATINUM" })).toBeNull();
    expect(within(editor).queryByRole("checkbox", { name: "Old" })).toBeNull();
    const apply = within(editor).getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();

    await userEvent.click(within(editor).getByRole("checkbox", { name: "tax free" }));
    expect(apply).toBeEnabled();
    await userEvent.click(apply);
    await waitFor(() => expect(puts).toEqual([{ tagIds: ["t-platinum", "t-taxfree"] }]));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Available tags/ })).toBeNull());
  });

  it("Search tags narrows the list; the order button turns it round", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={[]} canEdit canCreate />);
    await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));
    const editor = await screen.findByRole("dialog", { name: "Available tags (2)" });
    const names = () => within(editor).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));
    expect(names()).toEqual(["PLATINUM", "tax free"]);
    await userEvent.click(within(editor).getByRole("button", { name: "Sort tags" }));
    expect(names()).toEqual(["tax free", "PLATINUM"]);
    await userEvent.type(within(editor).getByRole("searchbox", { name: "Search tags" }), "tax");
    expect(names()).toEqual(["tax free"]);
  });

  it("+ Create new makes a tag from a typed name and puts it straight onto the client", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={[]} canEdit canCreate />);
    await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));
    const editor = await screen.findByRole("dialog", { name: /Available tags/ });
    await userEvent.click(within(editor).getByRole("button", { name: "Create new" }));
    await userEvent.type(within(editor).getByRole("textbox", { name: "Tag name" }), "VIP");
    await userEvent.click(within(editor).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(posts).toEqual([{ name: "VIP", color: "slate" }]));
    await waitFor(() => expect(puts).toEqual([{ tagIds: ["t-new"] }]));
  });

  it("offers no Create new without client_tags.create", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={[]} canEdit canCreate={false} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));
    const editor = await screen.findByRole("dialog", { name: /Available tags/ });
    expect(within(editor).queryByRole("button", { name: "Create new" })).toBeNull();
  });

  it("without contacts.edit the chips are read-only and there is no Add tag", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={["t-platinum"]} canEdit={false} canCreate={false} />);
    expect(await screen.findByText("PLATINUM")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add tag" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
