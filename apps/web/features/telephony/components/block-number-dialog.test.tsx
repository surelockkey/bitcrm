import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api/errors";
import { BlockNumberDialog } from "./block-number-dialog";

const mocks = vi.hoisted(() => ({
  block: vi.fn(async (values: { number: string; comment?: string }) => ({ id: "b1", ...values })),
}));

vi.mock("../blocked-callers-hooks", () => ({
  useBlockCaller: () => ({ mutateAsync: mocks.block, isPending: false }),
}));

/**
 * Workiz's "Block a Number" modal (feat_blocked_callers_wz_modal): the title,
 * a number box with the placeholder "Block a Number", a comment box with
 * "I am blocking this number because...", Cancel and Block.
 */
describe("BlockNumberDialog", () => {
  beforeEach(() => mocks.block.mockClear());

  it("draws Workiz's title, placeholders and buttons", () => {
    render(<BlockNumberDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Block a Number" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Block a Number")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("I am blocking this number because...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Block" })).toBeInTheDocument();
  });

  it("blocks the number with its comment and closes", async () => {
    const onOpenChange = vi.fn();
    render(<BlockNumberDialog open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByPlaceholderText("Block a Number"), "(214) 791-7112");
    await userEvent.type(screen.getByPlaceholderText("I am blocking this number because..."), "sales calls");
    await userEvent.click(screen.getByRole("button", { name: "Block" }));

    expect(mocks.block).toHaveBeenCalledWith({ number: "+12147917112", comment: "sales calls" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("opens on the call's number when there is one (Block this number)", async () => {
    render(<BlockNumberDialog open onOpenChange={() => {}} initialNumber="+12147917112" />);
    expect(screen.getByPlaceholderText("Block a Number")).toHaveValue("(214) 791-7112");
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(mocks.block).toHaveBeenCalledWith({ number: "+12147917112", comment: undefined });
  });

  it("refuses a number that is not one, without asking the server", async () => {
    render(<BlockNumberDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText("Block a Number"), "spam");
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a phone number");
    expect(mocks.block).not.toHaveBeenCalled();
  });

  it("says so when the number is already blocked", async () => {
    mocks.block.mockRejectedValueOnce(new ApiError(409, "+12147917112 is already blocked"));
    const onOpenChange = vi.fn();
    render(<BlockNumberDialog open onOpenChange={onOpenChange} initialNumber="2147917112" />);
    await userEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This number is already blocked");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
