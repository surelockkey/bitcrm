import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  jobTypes: [
    { id: "jt-svc", name: "Service", active: true, priority: 2 },
    { id: "jt-lock", name: "Lockout", active: true, priority: 1 },
  ] as unknown[],
  archivedType: null as unknown,
  sources: [{ id: "src-gmb", name: "SURE TX MCKINNEY (DAPPER) GMB", active: true, priority: 0 }] as unknown[],
  createType: vi.fn(),
  createSource: vi.fn(),
  externals: [{ id: "x1", name: "Angi", active: true }] as unknown[],
  profiles: [
    { id: "bp1", name: "SureLock", isDefault: true, active: true },
    { id: "bp2", name: "KeyPro", isDefault: false, active: true },
  ] as unknown[],
  areas: [
    { id: "sa-dal", name: "SURE LOCK DALLAS TX", active: true, priority: 0 },
    { id: "sa-aus", name: "SURE LOCK AUSTIN TX", active: true, priority: 0 },
  ] as unknown[],
  effective: { source: null, area: null, resolvedArea: null, isFetching: false } as Record<string, unknown>,
  techs: [] as unknown[],
  techsLoading: false,
  suggestArgs: [] as unknown[],
}));

vi.mock("@/features/job-types/active-hooks", () => ({ useActiveJobTypes: () => ({ data: m.jobTypes }) }));
vi.mock("@/features/job-types/hooks", () => ({
  useJobType: (_id: string, enabled: boolean) => ({ data: enabled ? m.archivedType : undefined }),
  useCreateJobType: () => ({ mutate: m.createType, isPending: false }),
}));
vi.mock("@/features/job-sources/active-hooks", () => ({ useActiveJobSources: () => ({ data: m.sources }) }));
vi.mock("@/features/job-sources/hooks", () => ({
  useJobSource: () => ({ data: undefined }),
  useCreateJobSource: () => ({ mutate: m.createSource, isPending: false }),
}));
vi.mock("@/features/external-companies/hooks", () => ({ useExternalCompanies: () => ({ data: m.externals }) }));
vi.mock("@/features/business-profiles/hooks", () => ({
  useActiveBusinessProfiles: () => ({ data: m.profiles, active: m.profiles, isLoading: false }),
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useServiceAreas: () => ({ data: m.areas }),
  useEffectiveServiceArea: () => m.effective,
}));
vi.mock("../../hooks", () => ({
  useSuggestedTechs: (params: unknown, enabled: boolean) => {
    m.suggestArgs.push({ params, enabled });
    return { data: enabled ? m.techs : undefined, isLoading: enabled && m.techsLoading };
  },
  useUserMap: () => ({ map: new Map([["t-old", { id: "t-old", firstName: "Old", lastName: "Hand" }]]) }),
}));

import {
  WzBusinessProfileSelect,
  WzCountrySelect,
  WzExternalCompanySelect,
  WzJobSourceSelect,
  WzJobTypeSelect,
  WzServiceAreaSelect,
  WzStateSelect,
  WzTeamSelect,
} from "./catalog-selects";

const combo = (name: string) => screen.getByRole("combobox", { name });
const open = async (name: string) =>
  userEvent.click(
    combo(name).closest("[data-slot=wz-select]")!.querySelector("[data-slot=wz-select-control]") as HTMLElement,
  );
const optionLabels = () => within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);

beforeEach(() => {
  m.archivedType = null;
  m.effective = { source: null, area: null, resolvedArea: null, isFetching: false };
  m.techs = [];
  m.techsLoading = false;
  m.suggestArgs = [];
  m.createType.mockReset();
  m.createSource.mockReset();
});

describe("WzJobTypeSelect", () => {
  it("is Workiz's 'Job type' select over the active catalog, emitting the id", async () => {
    const onChange = vi.fn();
    render(<WzJobTypeSelect value="" onChange={onChange} />);
    await open("Job type");
    expect(optionLabels()).toEqual(["Service", "Lockout"]);
    await userEvent.click(screen.getByRole("option", { name: "Lockout" }));
    expect(onChange).toHaveBeenCalledWith("jt-lock");
  });

  it("keeps showing an archived type the job still has", () => {
    m.archivedType = { id: "jt-old", name: "Safe", active: false, priority: 0 };
    render(<WzJobTypeSelect value="jt-old" onChange={vi.fn()} />);
    expect(screen.getByText("Safe (archived)")).toBeInTheDocument();
  });

  it("offers '+ Add new' only to someone who may create job types, and creates the typed one", async () => {
    const onChange = vi.fn();
    m.createType.mockImplementation((_body: unknown, opts: { onSuccess: (t: { id: string }) => void }) =>
      opts.onSuccess({ id: "jt-new" }),
    );
    const { rerender } = render(<WzJobTypeSelect value="" onChange={onChange} />);
    await open("Job type");
    expect(screen.queryByRole("option", { name: /add new/i })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    rerender(<WzJobTypeSelect value="" onChange={onChange} canCreate />);
    await userEvent.type(combo("Job type"), "Gate repair");
    await userEvent.click(screen.getByRole("option", { name: /add new/i }));
    expect(m.createType).toHaveBeenCalledWith(
      { name: "Gate repair", priority: 0, active: true },
      expect.anything(),
    );
    expect(onChange).toHaveBeenCalledWith("jt-new");
  });

  it("asks for a name when '+ Add new' is picked with nothing typed", async () => {
    render(<WzJobTypeSelect value="" onChange={vi.fn()} canCreate />);
    await open("Job type");
    await userEvent.click(screen.getByRole("option", { name: /add new/i }));
    const dialog = await screen.findByRole("dialog", { name: "Add job type" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Gate");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(m.createType).toHaveBeenCalledWith({ name: "Gate", priority: 0, active: true }, expect.anything());
  });
});

describe("WzJobSourceSelect", () => {
  it("is clearable, as Workiz's Job source is", async () => {
    const onChange = vi.fn();
    render(<WzJobSourceSelect value="src-gmb" onChange={onChange} />);
    expect(screen.getByText("SURE TX MCKINNEY (DAPPER) GMB")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear Job source" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("WzExternalCompanySelect / WzBusinessProfileSelect", () => {
  it("External company lists the enabled partners", async () => {
    render(<WzExternalCompanySelect value="" onChange={vi.fn()} />);
    await open("External company");
    expect(optionLabels()).toEqual(["Angi"]);
  });

  it("Company (our business profile) hints the default one", async () => {
    render(<WzBusinessProfileSelect value="bp1" onChange={vi.fn()} showDefaultHint />);
    expect(screen.getByText("SureLock (default company)")).toBeInTheDocument();
  });
});

describe("WzServiceAreaSelect", () => {
  it("shows the area the address lands in, Workiz-style, until one is picked by hand", () => {
    m.effective = {
      source: "resolved",
      area: { id: "sa-dal", name: "SURE LOCK DALLAS TX" },
      resolvedArea: { id: "sa-dal", name: "SURE LOCK DALLAS TX" },
      isFetching: false,
    };
    render(<WzServiceAreaSelect lat={33} lng={-96} value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText("SURE LOCK DALLAS TX (0 miles away)")).toBeInTheDocument();
  });

  it("is empty ('Service area') with no address, and a pick is a manual area", async () => {
    const onChange = vi.fn();
    render(<WzServiceAreaSelect value={undefined} onChange={onChange} />);
    expect(combo("Service area").closest("[data-slot=wz-select]")).toHaveAttribute("data-has-value", "false");
    await open("Service area");
    await userEvent.click(screen.getByRole("option", { name: "SURE LOCK AUSTIN TX" }));
    expect(onChange).toHaveBeenCalledWith("sa-aus");
  });
});

describe("WzStateSelect / WzCountrySelect", () => {
  it("State is a select of full names valued by code for the US", async () => {
    const onChange = vi.fn();
    render(<WzStateSelect country="US" value="TX" onChange={onChange} />);
    expect(screen.getByText("Texas")).toBeInTheDocument();
    await open("State");
    await userEvent.click(screen.getByRole("option", { name: "Utah" }));
    expect(onChange).toHaveBeenCalledWith("UT");
  });

  it("reads a state written out ('Texas') as its code", () => {
    render(<WzStateSelect country="US" value="Texas" onChange={vi.fn()} />);
    expect(screen.getByText("Texas")).toBeInTheDocument();
  });

  it("lists provinces for Canada and is a plain box elsewhere", () => {
    const { rerender } = render(<WzStateSelect country="CA" value="ON" onChange={vi.fn()} />);
    expect(screen.getByText("Ontario")).toBeInTheDocument();
    rerender(<WzStateSelect country="GB" value="Kent" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "State" })).toHaveValue("Kent");
  });

  it("Country defaults to United States and emits ISO codes", async () => {
    const onChange = vi.fn();
    render(<WzCountrySelect value={undefined} onChange={onChange} />);
    expect(screen.getByText("United States")).toBeInTheDocument();
    await userEvent.type(combo("Country"), "Canad");
    await userEvent.click(screen.getByRole("option", { name: "Canada" }));
    expect(onChange).toHaveBeenCalledWith("CA");
  });
});

describe("WzTeamSelect", () => {
  const tech = (id: string, first: string, eligible = true) => ({
    id,
    firstName: first,
    lastName: "Tech",
    eligible,
    reasons: eligible ? [] : ["missing_job_type"],
  });

  it("without a service area: Workiz's red notice and 'No options'", async () => {
    render(<WzTeamSelect jobTypeId="" address={{}} value={[]} onChange={vi.fn()} />);
    expect(screen.getByText("Please select a service area to display available techs")).toBeInTheDocument();
    await open("Assign team members");
    expect(screen.getByText("No options")).toBeInTheDocument();
  });

  it("with an area: how many techs can go, and picking adds to the team", async () => {
    m.effective = {
      source: "resolved",
      area: { id: "sa-dal", name: "SURE LOCK DALLAS TX" },
      resolvedArea: { id: "sa-dal", name: "SURE LOCK DALLAS TX" },
      isFetching: false,
    };
    m.techs = [tech("t1", "Ann"), tech("t2", "Bob"), tech("t3", "Cy", false)];
    const onChange = vi.fn();
    render(<WzTeamSelect jobTypeId="" address={{ lat: 33, lng: -96 }} value={[]} onChange={onChange} />);

    const notice = screen.getByTestId("wz-team-notice");
    expect(notice).toHaveTextContent("2 techs work in SURE LOCK DALLAS TX and can perform any job type");
    expect(within(notice).getByText("2").tagName).toBe("B");
    expect(within(notice).getByText("SURE LOCK DALLAS TX").tagName).toBe("B");
    expect(within(notice).getByText("any job type").tagName).toBe("B");

    await open("Assign team members");
    expect(screen.getByRole("option", { name: /Cy Tech/ })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("option", { name: "Bob Tech" }));
    expect(onChange).toHaveBeenCalledWith(["t2"]);
    // Asked by the address (and the job type, once there is one) — the same
    // question the page's loader asks, so the answer is already cached.
    expect(m.suggestArgs.at(-1)).toEqual({ params: { jobTypeId: undefined, lat: 33, lng: -96 }, enabled: true });
  });

  it("names the job type once there is one", () => {
    m.effective = { source: "resolved", area: { id: "a", name: "DALLAS" }, resolvedArea: null, isFetching: false };
    m.techs = [tech("t1", "Ann")];
    render(<WzTeamSelect jobTypeId="jt-svc" address={{ lat: 1, lng: 2 }} value={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("wz-team-notice")).toHaveTextContent("1 tech works in DALLAS and can perform Service");
  });

  it("keeps a tech already on the job, named from the directory", () => {
    m.effective = { source: "resolved", area: { id: "a", name: "DALLAS" }, resolvedArea: null, isFetching: false };
    render(<WzTeamSelect jobTypeId="" address={{ lat: 1, lng: 2 }} value={["t-old"]} onChange={vi.fn()} />);
    expect(screen.getByText("Old Hand")).toBeInTheDocument();
  });

  it("can hide the notice (the job page draws the team itself)", async () => {
    render(<WzTeamSelect jobTypeId="" address={{}} value={[]} onChange={vi.fn()} hideNotice />);
    await waitFor(() => expect(screen.queryByTestId("wz-team-notice")).not.toBeInTheDocument());
  });
});
