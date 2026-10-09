import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TemplatePicker } from "./template-picker";

const access = { canCreateTemplates: true };

vi.mock("../hooks", () => ({
  useTemplates: () => ({
    isLoading: false,
    data: [
      {
        id: "t1",
        messageTemplateTitle: "N/A for TECH",
        messageTemplate: "<p>Hi! Our technician has been trying to reach you.</p>",
        category: "Dispatch",
      },
      {
        id: "t2",
        messageTemplateTitle: "Pictures request",
        messageTemplate: "<p>Please attach the pictures here.</p>",
        category: "Sales",
      },
    ],
  }),
  useMessagingAccess: () => access,
}));

vi.mock("./template-form-dialog", () => ({
  TemplateFormDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="New template" /> : null),
}));

beforeEach(() => {
  access.canCreateTemplates = true;
});

/**
 * Workiz's "More replies" (pg_messages_wz_09_client_more_replies): a "Quick
 * reply" popover with a search box, a flat list of title + text, and
 * "+ New template" pinned to its foot.
 */
describe("TemplatePicker", () => {
  it("opens Workiz's Quick reply list: title, search, every template's title and text", async () => {
    render(<TemplatePicker channel="sms" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "More replies" }));

    const picker = screen.getByTestId("template-picker");
    expect(within(picker).getByRole("heading", { name: "Quick reply" })).toBeInTheDocument();
    expect(within(picker).getByPlaceholderText("Search...")).toHaveFocus();
    expect(within(picker).getByText("N/A for TECH")).toBeInTheDocument();
    expect(within(picker).getByText("Hi! Our technician has been trying to reach you.")).toBeInTheDocument();
    expect(within(picker).getByText("Pictures request")).toBeInTheDocument();
  });

  it("narrows the list by title or text as you type", async () => {
    render(<TemplatePicker channel="sms" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "More replies" }));
    await userEvent.type(screen.getByPlaceholderText("Search..."), "pictures");

    const picker = screen.getByTestId("template-picker");
    expect(within(picker).queryByText("N/A for TECH")).toBeNull();
    expect(within(picker).getByText("Pictures request")).toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText("Search..."));
    await userEvent.type(screen.getByPlaceholderText("Search..."), "technician");
    expect(within(picker).getByText("N/A for TECH")).toBeInTheDocument();
    expect(within(picker).queryByText("Pictures request")).toBeNull();
  });

  it("hands the picked template up and closes", async () => {
    const onPick = vi.fn();
    render(<TemplatePicker channel="sms" onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "More replies" }));
    await userEvent.click(screen.getByText("Pictures request"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }));
    expect(screen.queryByTestId("template-picker")).toBeNull();
  });

  it("closes on Escape", async () => {
    render(<TemplatePicker channel="sms" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "More replies" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("template-picker")).toBeNull();
  });

  it("offers + New template to someone who may create one, and opens the template form", async () => {
    render(<TemplatePicker channel="sms" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "More replies" }));
    await userEvent.click(screen.getByRole("button", { name: "New template" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "New template" })).toBeInTheDocument());
  });

  it("leaves + New template out for someone who may not", async () => {
    access.canCreateTemplates = false;
    render(<TemplatePicker channel="sms" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "More replies" }));
    expect(screen.queryByRole("button", { name: "New template" })).toBeNull();
  });
});
