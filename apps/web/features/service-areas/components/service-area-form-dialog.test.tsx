import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ServiceAreaType, type ServiceArea } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { ServiceAreaFormDialog } from "./service-area-form-dialog";

vi.mock("./polygon-map-editor", () => ({ PolygonMapEditor: () => null }));

const ok = (data: unknown) => HttpResponse.json({ success: true, data });
const base = { defaultPaymentTerms: "cash", dueDateBasis: "invoice_created" };

const area: ServiceArea = {
  id: "sa-1",
  name: "Hartford",
  priority: 0,
  active: true,
  timezone: "America/New_York",
  type: ServiceAreaType.ZIPS,
  definition: { type: ServiceAreaType.ZIPS, zips: [{ zip: "06101" }] },
  coverage: [],
  createdBy: "u",
  createdAt: "x",
  updatedAt: "x",
};

let put: unknown;
beforeEach(() => {
  put = undefined;
  server.use(
    http.get("*/telephony/numbers", () => ok([])),
    http.get("*/billing/business-profiles", () =>
      ok([
        { ...base, id: "bp-default", name: "SureLock", isDefault: true, active: true },
        { ...base, id: "bp-2", name: "KeyPro", isDefault: false, active: true },
      ]),
    ),
    http.put("*/deals/service-areas/sa-1", async ({ request }) => {
      put = await request.json();
      return ok({ ...area });
    }),
  );
});

describe("ServiceAreaFormDialog — sales tax & default company", () => {
  it("turns on a sales tax and picks a default company", async () => {
    const user = userEvent.setup();
    renderWithClient(<ServiceAreaFormDialog area={area} open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Tax name")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("switch", { name: "Charge sales tax in this area" }));
    const name = within(dialog).getByLabelText("Tax name");
    expect(name).toHaveAttribute("placeholder", "e.g. CT Sales Tax");
    await user.type(name, "CT Sales Tax");
    await user.type(within(dialog).getByLabelText("Tax rate (%)"), "6.35");

    await user.click(within(dialog).getByRole("combobox", { name: "Default company" }));
    await user.click(await screen.findByRole("option", { name: "KeyPro" }));

    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(put).toMatchObject({
        tax: { name: "CT Sales Tax", ratePercent: 6.35 },
        defaultBusinessProfileId: "bp-2",
      }),
    );
    expect(put).not.toHaveProperty("defaultTaxRateId");
  });

  it("clears an existing tax with tax: null", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <ServiceAreaFormDialog
        area={{ ...area, tax: { name: "CT Sales Tax", ratePercent: 6.35 }, defaultBusinessProfileId: "bp-2" }}
        open
        onOpenChange={() => {}}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Tax name")).toHaveValue("CT Sales Tax");
    expect(within(dialog).getByLabelText("Tax rate (%)")).toHaveValue(6.35);
    await user.click(within(dialog).getByRole("switch", { name: "Charge sales tax in this area" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toMatchObject({ tax: null, defaultBusinessProfileId: "bp-2" }));
  });

  it("blocks saving an invalid rate", async () => {
    const user = userEvent.setup();
    renderWithClient(<ServiceAreaFormDialog area={area} open onOpenChange={() => {}} />);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("switch", { name: "Charge sales tax in this area" }));
    await user.type(within(dialog).getByLabelText("Tax name"), "X");
    await user.type(within(dialog).getByLabelText("Tax rate (%)"), "101");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(dialog).getByText(/0–100% with at most 3 decimals/)).toBeInTheDocument();
  });
});
