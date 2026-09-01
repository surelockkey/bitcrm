import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneNumbersPage } from "./phone-numbers-page";

const mocks = vi.hoisted(() => ({
  can: vi.fn(() => true),
  numbers: [
    { sid: "PN1", phoneNumber: "+15412830739", friendlyName: "Main line" },
    { sid: "PN2", phoneNumber: "+14045551234", friendlyName: "Ads line" },
  ],
  settings: [{ phoneNumber: "+14045551234", sourceId: "src-google-ads" }],
  updateSettings: vi.fn(),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../numbers-hooks", () => ({
  useNumbers: () => ({ data: mocks.numbers, isLoading: false }),
  useReleaseNumber: () => ({ mutate: vi.fn(), isPending: false }),
  useNumberSettings: () => ({ data: mocks.settings, isLoading: false }),
  useUpdateNumberSettings: () => ({
    mutate: mocks.updateSettings,
    isPending: false,
  }),
}));
vi.mock("./buy-number-dialog", () => ({ BuyNumberDialog: () => null }));

// A plain button standing in for the source picker: shows the current value,
// clicking it "picks" a fixed source.
vi.mock("@/features/job-sources/components/job-source-select", () => ({
  JobSourceSelect: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (v: string | undefined) => void;
  }) => (
    <button type="button" onClick={() => onChange("src-picked")}>
      source:{value ?? "none"}
    </button>
  ),
}));

beforeEach(() => {
  mocks.can.mockReturnValue(true);
  mocks.updateSettings.mockReset();
});

describe("PhoneNumbersPage — job source per number", () => {
  it("shows each number's assigned source", () => {
    render(<PhoneNumbersPage />);

    expect(screen.getByText("Job source")).toBeInTheDocument();
    expect(screen.getByText("source:src-google-ads")).toBeInTheDocument();
    expect(screen.getByText("source:none")).toBeInTheDocument();
  });

  it("saves a new assignment for the number", async () => {
    const u = userEvent.setup();
    render(<PhoneNumbersPage />);

    await u.click(screen.getByText("source:none"));

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      phoneNumber: "+15412830739",
      sourceId: "src-picked",
    });
  });
});
