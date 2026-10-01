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

  it("Add tag lists the catalog's active tags the client doesn't have yet, and attaches the picked one", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={["t-platinum"]} canEdit canCreate />);
    await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));

    const list = await screen.findByRole("listbox");
    expect(within(list).getByText("tax free")).toBeInTheDocument();
    expect(within(list).queryByText("PLATINUM")).toBeNull();
    expect(within(list).queryByText("Old")).toBeNull();

    await userEvent.click(within(list).getByText("tax free"));
    await waitFor(() => expect(puts).toEqual([{ tagIds: ["t-platinum", "t-taxfree"] }]));
  });

  it("a name that isn't in the catalog can be created on the spot and goes straight onto the client", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={[]} canEdit canCreate />);
    await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));
    await userEvent.type(screen.getByRole("combobox"), "VIP");

    await userEvent.click(await screen.findByText('Create "VIP"'));
    await waitFor(() => expect(posts).toEqual([{ name: "VIP", color: "slate" }]));
    await waitFor(() => expect(puts).toEqual([{ tagIds: ["t-new"] }]));
  });

  it("offers no Create line for a name already in the catalog, and none at all without client_tags.create", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={[]} canEdit canCreate={false} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add tag" }));
    await userEvent.type(screen.getByRole("combobox"), "plat");
    expect(await screen.findByText("PLATINUM")).toBeInTheDocument();
    expect(screen.queryByText(/^Create/)).toBeNull();
  });

  it("without contacts.edit the chips are read-only and there is no Add tag", async () => {
    renderWithClient(<ClientTagsField contactId="c1" tagIds={["t-platinum"]} canEdit={false} canCreate={false} />);
    expect(await screen.findByText("PLATINUM")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add tag" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
