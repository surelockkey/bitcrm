import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneNumbersPage } from "./phone-numbers-page";

const mocks = vi.hoisted(() => ({
  numbers: [] as unknown[],
  setTechLine: vi.fn(),
  release: vi.fn(),
}));

vi.mock("../numbers-hooks", () => ({
  useNumbers: () => ({ data: mocks.numbers, isLoading: false }),
  useReleaseNumber: () => ({ mutate: mocks.release, isPending: false }),
  useSetTechnicianLine: () => ({ mutate: mocks.setTechLine, isPending: false }),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("./buy-number-dialog", () => ({ BuyNumberDialog: () => null }));

/**
 * The technician line is a workspace-level designation that happens to be
 * edited per number: exactly one number holds it, so the control reads as
 * "make this the line" rather than a per-number setting.
 */
describe("PhoneNumbersPage — technician line", () => {
  beforeEach(() => {
    mocks.setTechLine.mockReset();
    mocks.numbers = [
      { sid: "PN1", phoneNumber: "+14098777774", friendlyName: "Tech line", technicianLine: true },
      { sid: "PN2", phoneNumber: "+15412830739", friendlyName: "Main", technicianLine: false },
    ];
  });

  it("badges the number that currently holds it", () => {
    render(<PhoneNumbersPage />);
    expect(screen.getByText(/technician line/i)).toBeInTheDocument();
  });

  it("offers to designate a number that does not hold it", async () => {
    render(<PhoneNumbersPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /make technician line/i }),
    );

    expect(mocks.setTechLine).toHaveBeenCalledWith({ sid: "PN2", on: true });
  });

  it("offers to release the one that does", async () => {
    render(<PhoneNumbersPage />);

    await userEvent.click(
      screen.getByRole("button", { name: /clear technician line/i }),
    );

    expect(mocks.setTechLine).toHaveBeenCalledWith({ sid: "PN1", on: false });
  });

  /** Only ever one — the badge and the release control are both singular. */
  it("shows exactly one designated number", () => {
    render(<PhoneNumbersPage />);

    expect(
      screen.getAllByRole("button", { name: /clear technician line/i }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: /make technician line/i }),
    ).toHaveLength(1);
  });

  it("shows no badge when no number has been designated", () => {
    mocks.numbers = [
      { sid: "PN2", phoneNumber: "+15412830739", friendlyName: "Main", technicianLine: false },
    ];

    render(<PhoneNumbersPage />);

    expect(screen.queryByText(/^technician line$/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /make technician line/i }),
    ).toBeInTheDocument();
  });
});
