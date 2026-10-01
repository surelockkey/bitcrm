import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ItemAttribute } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  list: [] as ItemAttribute[],
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../api", () => ({
  listItemAttributes: () => Promise.resolve(mocks.list),
  createItemAttribute: (body: unknown) => mocks.create(body),
  updateItemAttribute: (id: string, body: unknown) => mocks.update(id, body),
  deleteItemAttribute: (id: string) => mocks.remove(id),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

import { CustomFields } from "./custom-fields";

const WORKIZ = ["ALL SKU", "In Store Location", "Link_UHS", "SKU_CRM"];

function attributes(): ItemAttribute[] {
  return WORKIZ.map((name, i) => ({ id: `attr-${i}`, name, type: "text", visible: false, resource: "items" }));
}

/** Every value map the component hands back; the last one is what the item now holds. */
const changes = vi.fn();
const latest = () => changes.mock.lastCall?.[0];

function Harness({
  initial,
  canManage = true,
  readOnly = false,
}: {
  initial: Record<string, string>;
  canManage?: boolean;
  readOnly?: boolean;
}) {
  const [values, setValues] = useState(initial);
  return (
    <CustomFields
      values={values}
      onChange={(next) => {
        setValues(next);
        changes(next);
      }}
      canManage={canManage}
      readOnly={readOnly}
    />
  );
}

beforeEach(() => {
  mocks.list = attributes();
  mocks.create.mockReset().mockImplementation(async (b) => ({ id: "new", resource: "items", ...b }));
  mocks.update.mockReset().mockImplementation(async (id, b) => ({
    ...mocks.list.find((a) => a.id === id),
    ...b,
    productsUpdated: 3,
    productsSkipped: 0,
  }));
  mocks.remove.mockReset().mockResolvedValue({ id: "x", deleted: true, productsUpdated: 2, productsSkipped: 0 });
  mocks.toastError.mockReset();
  changes.mockReset();
});

const rows = () => screen.getAllByTestId("custom-field-row");

describe("CustomFields", () => {
  it("lists every field in catalog order under “Custom Fields”, name as placeholder, value with the name on top", async () => {
    renderWithClient(<Harness initial={{ Link_UHS: "https://uhs/1" }} />);

    expect(await screen.findByRole("heading", { name: "Custom Fields" })).toBeInTheDocument();
    expect(rows().map((r) => r.querySelector("label")?.textContent)).toEqual(WORKIZ);

    const empty = screen.getByLabelText("ALL SKU");
    expect(empty).toHaveValue("");
    expect(screen.getByText("ALL SKU", { selector: "label" })).not.toHaveAttribute("data-floated");
    expect(screen.getByLabelText("Link_UHS")).toHaveValue("https://uhs/1");
    expect(screen.getByText("Link_UHS", { selector: "label" })).toHaveAttribute("data-floated");

    // Pencil and bin on every row, "+ Add custom fields" under the list.
    expect(screen.getAllByRole("button", { name: /^Edit custom field / })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /^Delete custom field / })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Add custom fields" })).toBeInTheDocument();
  });

  it("typing changes the item's values only (nothing is sent until the item's Save)", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness initial={{}} />);
    await user.type(await screen.findByLabelText("SKU_CRM"), "CRM-9");
    expect(latest()).toEqual({ SKU_CRM: "CRM-9" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("the pencil opens “Edit Custom field” with the type fixed; a rename is saved at once and the value follows", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness initial={{ Link_UHS: "https://uhs/1" }} />);

    await user.click(await screen.findByRole("button", { name: "Edit custom field Link_UHS" }));
    const dialog = screen.getByTestId("custom-field-dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Custom field" })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Type" })).toBeDisabled();
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("Link_UHS");

    await user.clear(name);
    await user.type(name, "UHS link");
    await user.click(within(dialog).getByRole("checkbox", { name: "Visible On Item List" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("attr-2", { name: "UHS link", type: "text", visible: true }),
    );
    await waitFor(() => expect(screen.queryByTestId("custom-field-dialog")).not.toBeInTheDocument());
    expect(latest()).toEqual({ "UHS link": "https://uhs/1" });
  });

  it("the bin asks first (Workiz wording), then deletes the field and drops its value", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness initial={{ SKU_CRM: "CRM-1", Link_UHS: "u" }} />);

    await user.click(await screen.findByRole("button", { name: "Delete custom field SKU_CRM" }));
    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText("Delete Custom Field?")).toBeInTheDocument();
    expect(
      within(confirm).getByText(
        "Deleting a custom field will remove its associated data. This action can not be undone.",
      ),
    ).toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("attr-3"));
    await waitFor(() => expect(latest()).toEqual({ Link_UHS: "u" }));
  });

  it("Cancel on the confirm deletes nothing", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness initial={{}} />);
    await user.click(await screen.findByRole("button", { name: "Delete custom field SKU_CRM" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("“+ Add custom fields” opens Name / Type (Text) / Visible On Item List and adds the field", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness initial={{}} />);

    await user.click(await screen.findByRole("button", { name: "Add custom fields" }));
    const dialog = screen.getByTestId("custom-field-dialog");
    expect(within(dialog).getByRole("heading", { name: "Add Custom fields" })).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Type" })).toHaveTextContent("Text");
    expect(within(dialog).getByRole("checkbox", { name: "Visible On Item List" })).not.toBeChecked();

    await user.type(within(dialog).getByLabelText("Name"), "  Bin  ");
    await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Quantity based number" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ name: "Bin", type: "quantity", visible: false }));
  });

  it("refuses a name already taken (any case) with Workiz's message, and an empty one", async () => {
    const user = userEvent.setup();
    renderWithClient(<Harness initial={{}} />);

    await user.click(await screen.findByRole("button", { name: "Add custom fields" }));
    const dialog = screen.getByTestId("custom-field-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Required");

    await user.type(within(dialog).getByLabelText("Name"), "sku_crm");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.toastError).toHaveBeenCalledWith("Name is in use, please pick a different one");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("without the right to manage fields: values only, no pencil / bin / add", async () => {
    renderWithClient(<Harness initial={{}} canManage={false} />);
    expect(await screen.findByLabelText("ALL SKU")).toBeEnabled();
    expect(screen.queryByRole("button", { name: /custom field/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add custom fields" })).not.toBeInTheDocument();
  });

  it("read-only: the values can't be typed in", async () => {
    renderWithClient(<Harness initial={{}} readOnly canManage={false} />);
    expect(await screen.findByLabelText("ALL SKU")).toBeDisabled();
  });

  it("with no fields yet: no title, just “+ Add custom fields”", async () => {
    mocks.list = [];
    renderWithClient(<Harness initial={{}} />);
    expect(await screen.findByRole("button", { name: "Add custom fields" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Custom Fields" })).not.toBeInTheDocument();
  });
});
