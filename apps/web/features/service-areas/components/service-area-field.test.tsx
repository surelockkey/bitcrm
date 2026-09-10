import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ServiceArea } from "@bitcrm/types";

const { listServiceAreas, resolveServiceArea, nearestServiceArea } = vi.hoisted(() => ({
  listServiceAreas: vi.fn(),
  resolveServiceArea: vi.fn(),
  nearestServiceArea: vi.fn(),
}));
vi.mock("../api", () => ({ listServiceAreas, resolveServiceArea, nearestServiceArea }));

import { ServiceAreaField } from "./service-area-field";

const area = (over: Partial<ServiceArea>): ServiceArea =>
  ({
    id: "a-hartford",
    name: "Hartford",
    priority: 0,
    active: true,
    timezone: "America/New_York",
    type: "zips",
    definition: { type: "zips", zips: [] },
    coverage: [],
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as ServiceArea;

const hartford = area({});
const newHaven = area({ id: "a-new-haven", name: "New Haven" });

function Harness({ lat, lng }: { lat?: number; lng?: number }) {
  const [value, setValue] = useState<string | undefined>(undefined);
  return <ServiceAreaField lat={lat} lng={lng} value={value} onChange={setValue} />;
}

function renderField(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  listServiceAreas.mockReset().mockResolvedValue([hartford, newHaven]);
  resolveServiceArea.mockReset();
  nearestServiceArea.mockReset();
});

describe("ServiceAreaField", () => {
  it("asks for the address before it can detect anything", () => {
    renderField(<Harness />);
    expect(screen.getByText(/set the address/i)).toBeInTheDocument();
  });

  it("shows the auto-detected area for a covered address", async () => {
    resolveServiceArea.mockResolvedValue(hartford);
    renderField(<Harness lat={41.76} lng={-72.67} />);
    await waitFor(() => expect(screen.getByText("Hartford")).toBeInTheDocument());
    expect(nearestServiceArea).not.toHaveBeenCalled();
  });

  it("falls back to the nearest area, with its distance, outside coverage", async () => {
    resolveServiceArea.mockResolvedValue(null);
    nearestServiceArea.mockResolvedValue({ area: newHaven, distanceMiles: 2180.4 });
    renderField(<Harness lat={36.17} lng={-115.14} />);

    await waitFor(() => expect(screen.getByText(/outside coverage/i)).toBeInTheDocument());
    expect(screen.getByText(/New Haven/)).toBeInTheDocument();
    expect(screen.getByText(/~2180 mi/)).toBeInTheDocument();
  });

  it("lets the dispatcher pick an area by hand, noting where the address falls", async () => {
    resolveServiceArea.mockResolvedValue(hartford);
    const u = userEvent.setup();
    renderField(<Harness lat={41.76} lng={-72.67} />);
    await waitFor(() => expect(screen.getByText("Hartford")).toBeInTheDocument());

    await u.click(screen.getByRole("combobox", { name: /service area/i }));
    await u.click(screen.getByRole("option", { name: "New Haven" }));

    // The hand-picked area is on the trigger; the auto-detected one is a hint.
    expect(screen.getByRole("combobox", { name: /service area/i })).toHaveTextContent(
      "New Haven",
    );
    expect(screen.getByText(/address falls in Hartford/i)).toBeInTheDocument();
  });

  it("still reports no coverage when there is nothing to fall back on", async () => {
    resolveServiceArea.mockResolvedValue(null);
    nearestServiceArea.mockResolvedValue(null);
    renderField(<Harness lat={36.17} lng={-115.14} />);
    await waitFor(() =>
      expect(screen.getByText(/no service area covers/i)).toBeInTheDocument(),
    );
  });
});
