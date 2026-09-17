import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../hooks", () => ({
  useSetCallTags: () => ({ mutate: mocks.mutate, isPending: false }),
}));

/**
 * The picker itself is covered by call-tag-combobox.test.tsx; here it is a
 * stub that reports what it was handed and can fire a new list back.
 */
vi.mock("@/features/call-tags/components/call-tag-combobox", () => ({
  CallTagCombobox: ({
    value,
    onChange,
    disabled,
    catalogEnabled,
    stopPropagation,
  }: {
    value: string[];
    onChange: (ids: string[]) => void;
    disabled?: boolean;
    catalogEnabled?: boolean;
    stopPropagation?: boolean;
  }) => (
    <div>
      <span data-testid="value">{value.join(",")}</span>
      <span data-testid="flags">
        {String(!!disabled)}/{String(!!catalogEnabled)}/{String(!!stopPropagation)}
      </span>
      <button type="button" onClick={() => onChange([...value, "ct-spam"])}>
        add spam
      </button>
      <button
        type="button"
        onClick={() => onChange(value.filter((v) => v !== "ct-tech"))}
      >
        drop tech
      </button>
      <button type="button" onClick={() => onChange([...value])}>
        no change
      </button>
    </div>
  ),
}));

import { CallTagsCell } from "./call-tags-cell";

const call = { callSid: "CA1", tagIds: ["ct-tech"] };

describe("CallTagsCell", () => {
  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.can.mockReset();
    mocks.can.mockReturnValue(true);
  });

  it("sends only what changed — an add, not the whole list", () => {
    render(<CallTagsCell call={call} />);
    fireEvent.click(screen.getByRole("button", { name: "add spam" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { sid: "CA1", add: ["ct-spam"], remove: [] },
      expect.anything(),
    );
  });

  it("sends a removal as a removal", () => {
    render(<CallTagsCell call={call} />);
    fireEvent.click(screen.getByRole("button", { name: "drop tech" }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { sid: "CA1", add: [], remove: ["ct-tech"] },
      expect.anything(),
    );
  });

  it("writes nothing when the list comes back unchanged", () => {
    render(<CallTagsCell call={call} />);
    fireEvent.click(screen.getByRole("button", { name: "no change" }));

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("shows the new chip immediately, and takes it back if the write fails", () => {
    render(<CallTagsCell call={call} />);
    fireEvent.click(screen.getByRole("button", { name: "add spam" }));
    expect(screen.getByTestId("value")).toHaveTextContent("ct-tech,ct-spam");

    // The server rejected it (archived tag, cap reached) — the toast explains
    // and the chip must not be left standing.
    const opts = mocks.mutate.mock.calls[0][1];
    act(() => {
      opts.onError?.();
      opts.onSettled?.();
    });
    expect(screen.getByTestId("value")).toHaveTextContent("ct-tech");
  });

  it("retires the optimistic list once the write settles", () => {
    render(<CallTagsCell call={call} />);
    fireEvent.click(screen.getByRole("button", { name: "add spam" }));

    act(() => mocks.mutate.mock.calls[0][1].onSettled?.());
    // The stored record has not caught up yet; what it says is still the
    // truth, and the hook has already put the server's list in the cache.
    expect(screen.getByTestId("value").textContent).toBe("ct-tech");
  });

  it("does not resurrect a settled draft when the stored list comes back round", () => {
    // Tag the call from the log, then take the tag off somewhere else (the
    // quick view, another dispatcher, an SSE refetch). The stored list is
    // exactly the one the draft was computed from again — the row must follow
    // the server, not re-show the chip it once proposed.
    const { rerender } = render(<CallTagsCell call={call} />);
    fireEvent.click(screen.getByRole("button", { name: "add spam" }));
    act(() => mocks.mutate.mock.calls[0][1].onSettled?.());

    rerender(<CallTagsCell call={{ callSid: "CA1", tagIds: ["ct-tech", "ct-spam"] }} />);
    expect(screen.getByTestId("value").textContent).toBe("ct-tech,ct-spam");

    rerender(<CallTagsCell call={{ callSid: "CA1", tagIds: ["ct-tech"] }} />);
    expect(screen.getByTestId("value").textContent).toBe("ct-tech");
  });

  it("treats an untagged call as an empty list", () => {
    render(<CallTagsCell call={{ callSid: "CA2" }} />);
    expect(screen.getByTestId("value")).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: "add spam" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { sid: "CA2", add: ["ct-spam"], remove: [] },
      expect.anything(),
    );
  });

  it("is read-only, and asks for no catalog, without settings.view", () => {
    // The catalog route is behind settings.view — firing it anyway is a
    // guaranteed 403 on every row of the log.
    mocks.can.mockImplementation((resource: string) => resource !== "settings");
    render(<CallTagsCell call={call} />);

    expect(screen.getByTestId("flags")).toHaveTextContent("true/false/false");
  });

  it("is read-only for someone who cannot see calls", () => {
    mocks.can.mockImplementation((resource: string) => resource !== "calls");
    render(<CallTagsCell call={call} />);

    expect(screen.getByTestId("flags")).toHaveTextContent("true/true/false");
  });

  it("stops row clicks when it sits in the call log", () => {
    render(<CallTagsCell call={call} inRow />);
    expect(screen.getByTestId("flags")).toHaveTextContent("false/true/true");
  });
});
