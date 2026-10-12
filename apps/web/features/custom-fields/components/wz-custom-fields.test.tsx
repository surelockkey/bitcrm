import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomFieldDefinition } from "@bitcrm/types";

const m = vi.hoisted(() => ({
  defs: [] as unknown[],
  requestUpload: vi.fn(),
  requestContactUpload: vi.fn(),
  uploadBytes: vi.fn(),
  urls: new Map<string, string>(),
}));

vi.mock("../hooks", () => ({ useCustomFields: () => ({ data: m.defs }) }));
vi.mock("@/features/deals/attachments-api", () => ({
  requestAttachmentUpload: (...a: unknown[]) => m.requestUpload(...a),
  uploadAttachmentBytes: (...a: unknown[]) => m.uploadBytes(...a),
  getAttachmentDownloadUrl: vi.fn(),
  requestContactAttachmentUpload: (...a: unknown[]) => m.requestContactUpload(...a),
  getContactAttachmentDownloadUrl: vi.fn(),
}));
vi.mock("../contact-file-urls", () => ({
  useContactFileUrls: (_contact: string, ids: string[]) =>
    ids.map((id) => ({ data: m.urls.has(id) ? { downloadUrl: m.urls.get(id) } : undefined })),
}));
vi.mock("@/features/deals/attachments-hooks", () => ({
  useAttachmentUrls: (_deal: string, ids: string[]) =>
    ids.map((id) => ({ data: m.urls.has(id) ? { downloadUrl: m.urls.get(id) } : undefined })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { WzCustomFieldControl, WzCustomFields } from "./wz-custom-fields";

function def(over: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "cf",
    name: "Field",
    type: "text",
    group: "Extra Info",
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
    ...over,
  };
}

const ALL = [
  def({ id: "cf-dispatch", name: "Jobs Dispatch", type: "dropdown", group: "Extra Info", options: ["No Price Job (2)", "Price Job"] }),
  def({ id: "cf-add", name: "Additional number", type: "text", group: "Other Contact" }),
  def({ id: "cf-note", name: "Manager Note", type: "large_text", group: "Dispatchers", priority: 9 }),
  def({ id: "cf-num", name: "Tech Parts cost", type: "number", group: "Tech" }),
  def({ id: "cf-img", name: "Check Image Front", type: "file", group: "Tech", priority: 5 }),
  def({ id: "cf-flag", name: "Warranty", type: "checkbox", group: "Platinum" }),
  def({ id: "cf-date", name: "WO Date", type: "date", group: "Platinum" }),
  def({ id: "cf-multi", name: "Parts", type: "multi_select", group: "Platinum", options: ["Cylinder", "Key"] }),
  def({ id: "cf-scoped", name: "Only for safes", type: "text", group: "Extra Info", jobTypeIds: ["jt-safe"] }),
];

beforeEach(() => {
  m.defs = ALL;
  m.requestUpload.mockReset();
  m.uploadBytes.mockReset();
  m.requestContactUpload.mockReset();
  m.urls.clear();
});

describe("WzCustomFields — card layout (New Job)", () => {
  it("gives each group its own Workiz card, in Workiz's order", () => {
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={vi.fn()} />);
    const cards = screen.getAllByRole("region");
    expect(cards.map((c) => c.getAttribute("aria-labelledby") && within(c).getByRole("heading").textContent)).toEqual([
      "Extra Info",
      "Other Contact",
      "Dispatchers",
      "Tech",
      "Platinum",
    ]);
    // Scoped to another job type: not here.
    expect(screen.queryByText("Only for safes")).not.toBeInTheDocument();
  });

  // new_01_empty_scroll1: Extra Info / Dispatchers / Platinum at x264, Other
  // Contact / Tech at x939 — each card pinned to its column by name, so the
  // page's flowing grid keeps Workiz's sides whatever groups exist (app_audit #7).
  it("pins each card to Workiz's column", () => {
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={vi.fn()} />);
    const column = (title: string) => screen.getByRole("region", { name: title }).className;
    expect(column("Extra Info")).toContain("col-start-1");
    expect(column("Other Contact")).toContain("col-start-2");
    expect(column("Dispatchers")).toContain("col-start-1");
    expect(column("Tech")).toContain("col-start-2");
    expect(column("Platinum")).toContain("col-start-1");
  });

  it("keeps Dispatchers left and Tech right without an Other Contact group", () => {
    m.defs = ALL.filter((d) => d.group !== "Other Contact");
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={vi.fn()} />);
    const column = (title: string) => screen.getByRole("region", { name: title }).className;
    expect(column("Dispatchers")).toContain("col-start-1");
    expect(column("Tech")).toContain("col-start-2");
  });

  it("draws each type with its kit control", () => {
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={vi.fn()} dealId="d1" />);
    expect(screen.getByRole("combobox", { name: "Jobs Dispatch" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Additional number" })).toBeInTheDocument();
    // Long text: the textarea named — and placeholdered — by the field.
    expect(screen.getByRole("textbox", { name: "Manager Note" })).toHaveAttribute("placeholder", "Manager Note");
    expect(screen.getByRole("spinbutton", { name: "Tech Parts cost" })).toBeInTheDocument();
    const upload = screen.getByRole("group", { name: "Check Image Front" });
    expect(upload).toHaveTextContent("You can choose up to 5 files");
    expect(screen.getByRole("checkbox", { name: "Warranty" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "WO Date" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Parts" })).toBeInTheDocument();
  });

  it("writes answers back as a fresh map; clearing one removes it", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WzCustomFields layout="card" jobTypeId="jt-1" value={{ "cf-num": 5 }} onChange={onChange} />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Additional number" }), "7");
    expect(onChange).toHaveBeenLastCalledWith({ "cf-num": 5, "cf-add": "7" });

    fireEvent.change(screen.getByRole("spinbutton", { name: "Tech Parts cost" }), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({});

    rerender(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Warranty" }));
    expect(onChange).toHaveBeenLastCalledWith({ "cf-flag": true });
  });

  it("picks a dropdown answer", async () => {
    const onChange = vi.fn();
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox", { name: "Jobs Dispatch" }), "Price");
    await userEvent.click(screen.getByRole("option", { name: "Price Job" }));
    expect(onChange).toHaveBeenLastCalledWith({ "cf-dispatch": "Price Job" });
  });

  it("marks the fields a blocked Create left empty: 'Required field'", () => {
    render(
      <WzCustomFields
        layout="card"
        jobTypeId="jt-1"
        value={{}}
        onChange={vi.fn()}
        dealId="d1"
        missingIds={["cf-add", "cf-img"]}
      />,
    );
    expect(screen.getAllByText("Required field")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Additional number" })).toHaveAttribute("aria-invalid", "true");
  });

  it("holds files for a job that does not exist yet", async () => {
    const onPendingFiles = vi.fn();
    render(
      <WzCustomFields
        layout="card"
        jobTypeId="jt-1"
        value={{}}
        onChange={vi.fn()}
        pendingFiles={{ "cf-img": [new File(["x"], "old.jpg", { type: "image/jpeg" })] }}
        onPendingFiles={onPendingFiles}
      />,
    );
    const upload = screen.getByRole("group", { name: "Check Image Front" });
    expect(within(upload).getByRole("button", { name: "Open old.jpg" })).toBeInTheDocument();
    const file = new File(["y"], "check.jpg", { type: "image/jpeg" });
    fireEvent.change(within(upload).getByLabelText("Add files to Check Image Front", { selector: "input" }), {
      target: { files: [file] },
    });
    expect(onPendingFiles).toHaveBeenCalledWith("cf-img", [expect.objectContaining({ name: "old.jpg" }), file]);
  });

  it("uploads straight away on a saved job and stores the attachment ids", async () => {
    m.requestUpload.mockResolvedValue({ id: "att-2", uploadUrl: "u", headers: {} });
    m.uploadBytes.mockResolvedValue(undefined);
    m.urls.set("att-1", "https://s3/att-1.jpg");
    const onChange = vi.fn();
    render(
      <WzCustomFields layout="card" jobTypeId="jt-1" value={{ "cf-img": ["att-1"] }} onChange={onChange} dealId="d1" />,
    );
    const upload = screen.getByRole("group", { name: "Check Image Front" });
    expect(within(upload).getByRole("img")).toHaveAttribute("src", "https://s3/att-1.jpg");
    fireEvent.change(within(upload).getByLabelText("Add files to Check Image Front", { selector: "input" }), {
      target: { files: [new File(["y"], "b.jpg", { type: "image/jpeg" })] },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ "cf-img": ["att-1", "att-2"] }));
    expect(m.requestUpload).toHaveBeenCalledWith("d1", expect.objectContaining({ fileName: "b.jpg" }));
  });

  it("asks to save first when a file cannot be held or uploaded", () => {
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={vi.fn()} />);
    expect(screen.getByText("Save the job first to attach a file.")).toBeInTheDocument();
  });

  it("can draw a single group", () => {
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={vi.fn()} onlyGroup="Tech" />);
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });

  it("is read-only when disabled", () => {
    render(<WzCustomFields layout="card" jobTypeId="jt-1" value={{}} onChange={vi.fn()} disabled dealId="d1" />);
    expect(screen.getByRole("textbox", { name: "Additional number" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Add files to Check Image Front" })).not.toBeInTheDocument();
  });
});

/**
 * One field's control on its own — what the client card's Custom fields tab
 * draws. A client's file field uploads to the CLIENT's files (the card's
 * Files rail) and keeps the attachment ids as its answer.
 */
describe("WzCustomFieldControl", () => {
  const file = def({ id: "cf-wo", name: "Work Order", type: "file", group: "Work Order", entityType: "client" });

  it("uploads a client's file to the client's files and stores its id", async () => {
    m.requestContactUpload.mockResolvedValue({ id: "att-9", uploadUrl: "u", headers: {} });
    m.uploadBytes.mockResolvedValue(undefined);
    m.urls.set("att-1", "https://s3/c-att-1.jpg");
    const onChange = vi.fn();
    render(<WzCustomFieldControl field={file} value={["att-1"]} onChange={onChange} contactId="c1" />);

    const upload = screen.getByRole("group", { name: "Work Order" });
    expect(within(upload).getByRole("img")).toHaveAttribute("src", "https://s3/c-att-1.jpg");
    fireEvent.change(within(upload).getByLabelText("Add files to Work Order", { selector: "input" }), {
      target: { files: [new File(["y"], "wo.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["att-1", "att-9"]));
    expect(m.requestContactUpload).toHaveBeenCalledWith("c1", expect.objectContaining({ fileName: "wo.pdf" }));
    expect(m.requestUpload).not.toHaveBeenCalled();
  });

  it("draws a text field as Workiz's floating-label box", () => {
    render(<WzCustomFieldControl field={def({ name: "Vendor Number 1" })} value="707748" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Vendor Number 1" })).toHaveValue("707748");
  });

  // pg_contact_wz_269669_tab_custom-fields: the client page draws its fields
  // in Workiz's newer outlined boxes — 40px text, 42px select, 13px labels.
  it("draws the client page's outlined boxes with look=outlined", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <>
        <WzCustomFieldControl look="outlined" field={def({ id: "v", name: "Vendor Number 1" })} value="" onChange={onChange} />
        <WzCustomFieldControl
          look="outlined"
          field={def({ id: "p", name: "Platinum Company name", type: "dropdown", options: ["Sure Lock & Key", "DBA"] })}
          value="DBA"
          onChange={vi.fn()}
        />
      </>,
    );
    expect(container.querySelectorAll("[data-slot=wz-outlined-text-field]")).toHaveLength(1);
    await userEvent.type(screen.getByLabelText("Vendor Number 1"), "7");
    expect(onChange).toHaveBeenLastCalledWith("7");
    expect(screen.getByRole("combobox", { name: "Platinum Company name" })).toBeInTheDocument();
  });
});

describe("WzCustomFields — section layout (job page)", () => {
  it("draws each group as a section under a ruled heading", () => {
    render(<WzCustomFields layout="section" jobTypeId="jt-1" value={{}} onChange={vi.fn()} dealId="d1" />);
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(["Extra Info", "Other Contact", "Dispatchers", "Tech", "Platinum"]);
    expect(screen.queryAllByRole("region")).toHaveLength(5);
  });

  it("renders nothing when no field applies", () => {
    m.defs = [];
    const { container } = render(
      <WzCustomFields layout="section" jobTypeId="jt-1" value={{}} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
