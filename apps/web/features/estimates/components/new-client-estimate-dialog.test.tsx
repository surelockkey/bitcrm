import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Contact } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The new-client form is the contacts page's own; here it only has to hand back the client it made.
vi.mock("@/features/clients/components/contact-form", () => ({
  ContactForm: ({ onDone, onCancel }: { onDone: (c: Contact) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onDone({ id: "c-new", firstName: "Nina", lastName: "New" } as Contact)}>
        Create contact
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

import { NewClientEstimateDialog } from "./new-client-estimate-dialog";

const contact = (id: string, firstName: string, lastName: string, phone: string) =>
  ({ id, firstName, lastName, phones: [phone], emails: [], addresses: [] }) as unknown as Contact;

let created: unknown[] = [];
beforeEach(() => {
  created = [];
  mocks.push.mockClear();
  server.use(
    http.get("*/search", () =>
      HttpResponse.json({
        success: true,
        data: { query: "smi", mode: "full", groups: [], hits: [{ entityId: "c1", type: "contact", title: "Jane Smith", badges: [], score: 1 }, { entityId: "c2", type: "contact", title: "Sam Smiley", badges: [], score: 1 }] },
      }),
    ),
    http.post("*/crm/contacts/by-ids", () =>
      HttpResponse.json({ success: true, data: [contact("c1", "Jane", "Smith", "+14045550123"), contact("c2", "Sam", "Smiley", "+14045550199")] }),
    ),
    http.post("*/billing/estimates", async ({ request }) => {
      const body = await request.json();
      created.push(body);
      return HttpResponse.json({ success: true, data: { id: "e9", number: "1001", contactId: (body as { contactId: string }).contactId, status: "unsent", items: [] } });
    }),
  );
});

describe("NewClientEstimateDialog — Workiz's Add New on the Estimates page", () => {
  it("asks for a client first, then makes their estimate and opens it", async () => {
    renderWithClient(<NewClientEstimateDialog open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Create New Estimate" });
    expect(within(dialog).getByText("Before we proceed, please select a client")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "+ Add new client" })).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole("combobox", { name: "Name, email or phone" }), "smi");
    const option = await within(dialog).findByRole("option", { name: /Jane Smith/ });
    expect(within(dialog).getByRole("option", { name: /Sam Smiley/ })).toBeInTheDocument();
    await userEvent.click(option);

    await waitFor(() => expect(created).toEqual([{ contactId: "c1" }]));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/estimates/e9"));
  });

  it("+ Add new client: the new client gets the estimate", async () => {
    renderWithClient(<NewClientEstimateDialog open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add new client" }));
    await userEvent.click(await screen.findByRole("button", { name: "Create contact" }));
    await waitFor(() => expect(created).toEqual([{ contactId: "c-new" }]));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/estimates/e9"));
  });

  it("Cancel on the new-client form goes back to the search", async () => {
    renderWithClient(<NewClientEstimateDialog open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add new client" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("combobox", { name: "Name, email or phone" })).toBeInTheDocument();
    expect(created).toEqual([]);
  });
});
