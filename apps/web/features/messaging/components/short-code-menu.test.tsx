import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShortCode } from "../api";
import { ShortCodeMenu } from "./short-code-menu";

const codes: ShortCode[] = [
  { code: "first_name", group: "client", description: "The client's first name", example: "Dana" },
  // The call-alert codes the server added for "When a call comes in" notifications.
  { code: "caller_number", group: "call", description: "The caller's number", example: "(404) 555-1234" },
  { code: "call_status", group: "call", description: "How the call ended", example: "Missed" },
  { code: "job_id", group: "job", description: "The job's ID", example: "5TU7ZA" },
];

vi.mock("../hooks", () => ({ useShortCodes: () => ({ data: codes, isLoading: false }) }));

/**
 * The menu lists every group the server knows, under its own heading: a code
 * in a group the menu has no row for would simply never be offered.
 */
describe("ShortCodeMenu", () => {
  it("offers the call-alert codes under a Call heading, between the job's and the business's", async () => {
    const onInsert = vi.fn();
    render(<ShortCodeMenu onInsert={onInsert} />);
    await userEvent.click(screen.getByRole("button", { name: "Insert a short code" }));

    expect(screen.getByText("Call")).toBeInTheDocument();
    const labels = screen.getAllByText(/^(Client|Job|Call)$/).map((el) => el.textContent);
    expect(labels).toEqual(["Client", "Job", "Call"]);

    await userEvent.click(screen.getByText("{{caller_number}}"));
    expect(onInsert).toHaveBeenCalledWith("{{caller_number}}");
  });
});
