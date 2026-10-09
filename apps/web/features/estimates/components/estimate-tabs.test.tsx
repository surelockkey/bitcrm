import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { EstimateTabs } from "./estimate-tabs";

const list = [
  { id: "e1", name: "Grade 3", createdAt: "2026-10-08T10:00:00.000Z" },
  { id: "e2", name: null, createdAt: "2026-10-08T11:00:00.000Z" },
];

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

/** Workiz's estimate tabs (pg_estimate_wz_01_job, EditableTabs): links, the open one barred, "Add estimate" in blue. */
describe("EstimateTabs", () => {
  it("lists the job's estimates as tabs, named or 'Estimate N', the open one selected", () => {
    render(<EstimateTabs estimates={list} currentId="e1" canCreate onNew={vi.fn()} />);
    const tabs = screen.getByRole("tablist", { name: "Estimates" });
    expect(within(tabs).getByRole("tab", { name: "Grade 3" })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: "Estimate 2" })).toHaveAttribute("href", "/estimates/e2");
  });

  it("'Add estimate' (words only) offers New estimate and Make a copy", async () => {
    const onNew = vi.fn();
    const onCopy = vi.fn();
    render(<EstimateTabs estimates={list} currentId="e1" canCreate onNew={onNew} onCopy={onCopy} />);
    const add = screen.getByRole("button", { name: "Add estimate" });
    expect(add).toHaveTextContent(/^Add estimate$/);
    await user().click(add);
    await user().click(await screen.findByRole("menuitem", { name: "New estimate" }));
    expect(onNew).toHaveBeenCalledOnce();
    await user().click(add);
    await user().click(await screen.findByRole("menuitem", { name: "Make a copy" }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("renames the open estimate in its tab, as Workiz edits the tab: Enter saves", async () => {
    const onRename = vi.fn();
    render(<EstimateTabs estimates={list} currentId="e1" canCreate onNew={vi.fn()} onRename={onRename} />);
    const u = user();
    await u.click(screen.getByRole("button", { name: "Rename estimate" }));
    const box = screen.getByRole("textbox", { name: "Estimate name" });
    expect(box).toHaveValue("Grade 3");
    expect(box).toHaveFocus();
    await u.clear(box);
    await u.type(box, "Grade 3 + closer{Enter}");
    expect(onRename).toHaveBeenCalledWith("Grade 3 + closer");
    expect(screen.queryByRole("textbox", { name: "Estimate name" })).not.toBeInTheDocument();
  });

  it("Escape keeps the name; nothing changed saves nothing", async () => {
    const onRename = vi.fn();
    render(<EstimateTabs estimates={list} currentId="e1" canCreate onNew={vi.fn()} onRename={onRename} />);
    const u = user();
    await u.click(screen.getByRole("button", { name: "Rename estimate" }));
    await u.type(screen.getByRole("textbox", { name: "Estimate name" }), " X{Escape}");
    await u.click(screen.getByRole("button", { name: "Rename estimate" }));
    await u.keyboard("{Enter}");
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Grade 3" })).toBeInTheDocument();
  });

  it("offers no rename without the right to edit, and no Add estimate without the right to create", () => {
    render(<EstimateTabs estimates={list} currentId="e1" canCreate={false} onNew={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Rename estimate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add estimate" })).not.toBeInTheDocument();
  });
});
