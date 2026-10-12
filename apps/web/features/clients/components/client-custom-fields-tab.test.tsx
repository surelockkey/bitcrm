import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Contact, CustomFieldDefinition } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ClientCustomFieldsTab } from "./client-custom-fields-tab";

function def(over: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "cf",
    name: "Field",
    type: "text",
    group: "",
    options: [],
    jobTypeIds: [],
    required: false,
    requiredToClose: false,
    searchable: false,
    priority: 0,
    active: true,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    entityType: "client",
    ...over,
  };
}

/** The SureLock account's six client fields (dump: reference/custom_fields_client.json) and a job field. */
const CATALOG = [
  def({ id: "cf-wo", name: "Work Order", type: "file", group: "Work Order", priority: 3 }),
  def({ id: "cf-v1", name: "Vendor Number 1", group: "Work Order", priority: 2, searchable: true }),
  def({ id: "cf-v2", name: "Vendor N 2", group: "Work Order", priority: 1, searchable: true }),
  def({ id: "cf-pl", name: "Platinum", group: "Platinum Info", priority: 1, searchable: true }),
  def({
    id: "cf-pc",
    name: "Platinum Company name",
    type: "dropdown",
    group: "Extra Info",
    priority: 2,
    options: ["Sure Lock & Key", "DBA", "The Right Choice Lockmsith"],
  }),
  def({ id: "cf-gd", name: "Google Drive Link", group: "Extra Info", priority: 1 }),
  def({ id: "cf-job", name: "Gate Code", group: "Work Order", entityType: "job" }),
];

const CONTACT = {
  id: "c1",
  firstName: "Grata",
  lastName: "Smart Living",
  phones: [],
  emails: [],
  addresses: [],
  customFields: { "cf-v1": "707748", "cf-pc": "Sure Lock & Key", "workiz:f21": "Jason" },
  type: "residential",
  source: "manual",
  status: "active",
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
} as unknown as Contact;

let saved: unknown[];

beforeEach(() => {
  saved = [];
  server.use(
    http.get("*/deals/custom-fields", () => HttpResponse.json({ success: true, data: CATALOG })),
    http.put("*/crm/contacts/c1", async ({ request }) => {
      const body = await request.json();
      saved.push(body);
      return HttpResponse.json({ success: true, data: CONTACT });
    }),
  );
});

describe("ClientCustomFieldsTab — Workiz's client page Custom fields tab", () => {
  it("lays the client fields out as Workiz does: Work Order | Platinum Info, then Extra Info; no job field", async () => {
    renderWithClient(<ClientCustomFieldsTab contact={CONTACT} canEdit canCreateField />);

    const workOrder = await screen.findByRole("region", { name: "Work Order" });
    const columns = screen.getAllByTestId("client-cf-column");
    expect(within(columns[0]).getByRole("region", { name: "Work Order" })).toBe(workOrder);
    expect(within(columns[0]).getByRole("region", { name: "Extra Info" })).toBeInTheDocument();
    expect(within(columns[1]).getByRole("region", { name: "Platinum Info" })).toBeInTheDocument();

    expect(within(workOrder).getByRole("group", { name: "Work Order" })).toHaveTextContent("You can choose up to 5 files");
    expect(within(workOrder).getByLabelText("Vendor Number 1")).toHaveValue("707748");
    expect(within(workOrder).getByLabelText("Vendor N 2")).toHaveValue("");
    expect(screen.queryByText("Gate Code")).not.toBeInTheDocument();
  });

  it("Save sends only the answers changed — a cleared one as null — and stays off until something changes", async () => {
    renderWithClient(<ClientCustomFieldsTab contact={CONTACT} canEdit canCreateField />);
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("Vendor Number 1"));
    await userEvent.type(screen.getByLabelText("Vendor N 2"), "112763");
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ customFields: { "cf-v1": null, "cf-v2": "112763" } });
  });

  it("links to Settings → Custom Fields → Client for whoever may add a field", async () => {
    renderWithClient(<ClientCustomFieldsTab contact={CONTACT} canEdit canCreateField />);
    expect(await screen.findByText(/Need to track more fields\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a custom field" })).toHaveAttribute(
      "href",
      "/settings/custom-fields?tab=client",
    );
  });

  it("shows the answers read-only, with no Save and no link, to whoever cannot edit the client", async () => {
    renderWithClient(<ClientCustomFieldsTab contact={CONTACT} canEdit={false} canCreateField={false} />);
    expect(await screen.findByLabelText("Vendor Number 1")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create a custom field" })).not.toBeInTheDocument();
  });

  it("says there are none yet when the account has no client fields", async () => {
    server.use(http.get("*/deals/custom-fields", () => HttpResponse.json({ success: true, data: [CATALOG[6]] })));
    renderWithClient(<ClientCustomFieldsTab contact={CONTACT} canEdit canCreateField />);
    expect(await screen.findByText("No client custom fields yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
