import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { JobTag } from "@bitcrm/types";

const { createMutate, canMock } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  canMock: vi.fn(),
}));

const makeTag = (over: Partial<JobTag>): JobTag => ({
  id: "t1",
  name: "Rush",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

vi.mock("../hooks", () => ({
  useJobTags: () => ({
    data: [makeTag({ id: "t-rush", name: "Rush" }), makeTag({ id: "t-vip", name: "VIP", color: "violet" })],
  }),
  useCreateJobTag: () => ({ mutate: createMutate, isPending: false }),
  useUpdateJobTag: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: canMock }),
}));

// Radix portal/animation wrapper; render children directly (same pattern as
// deal-quick-view.test.tsx does for the Sheet).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { JobTagCombobox } from "./job-tag-combobox";

const openPickerAndType = (text: string) => {
  fireEvent.click(screen.getByRole("button", { name: /add tag/i }));
  fireEvent.change(screen.getByPlaceholderText("Search tags…"), { target: { value: text } });
};

describe("JobTagCombobox — create tag from the picker", () => {
  beforeEach(() => {
    createMutate.mockReset();
    canMock.mockReset();
    canMock.mockReturnValue(true);
  });

  it("creates the typed tag through the form dialog and selects it on the job", () => {
    createMutate.mockImplementation((body: { name: string }, opts?: { onSuccess?: (t: JobTag) => void }) => {
      opts?.onSuccess?.(makeTag({ id: "t-new", name: body.name, color: "slate" }));
    });
    const onChange = vi.fn();

    render(<JobTagCombobox value={[]} onChange={onChange} />);
    openPickerAndType("Emergency");

    // The catalog has no "Emergency", so the picker offers to create it.
    fireEvent.click(screen.getByRole("button", { name: /create .*Emergency/i }));

    // The tag form opens prefilled with what was typed…
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("Emergency")).toBeInTheDocument();

    // …and submitting it creates the tag and attaches it to the job.
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Emergency" }),
      expect.anything(),
    );
    expect(onChange).toHaveBeenCalledWith(["t-new"]);
  });

  it("does not offer creation when the typed name already exists in the catalog", () => {
    render(<JobTagCombobox value={[]} onChange={vi.fn()} />);
    openPickerAndType("rush");

    expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
  });

  it("hides the create option without the job_tags.create permission", () => {
    canMock.mockReturnValue(false);

    render(<JobTagCombobox value={[]} onChange={vi.fn()} />);
    openPickerAndType("Emergency");

    expect(screen.queryByRole("button", { name: /create/i })).not.toBeInTheDocument();
  });
});
