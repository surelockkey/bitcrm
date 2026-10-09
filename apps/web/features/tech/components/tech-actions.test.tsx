import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ClientType,
  DealPriority,
  DealStatus,
  JobSuperStatus,
  type Deal,
} from "@bitcrm/types";
import { TechActions } from "./tech-actions";

const can = vi.fn((resource: string) => Boolean(resource));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can, isTechnician: true, isLoading: false }),
}));

const confirm = { mutate: vi.fn(), isPending: false };
const arrive = { mutate: vi.fn(), isPending: false };
const onMyWay = { mutate: vi.fn(), isPending: false };
const late = { mutate: vi.fn(), isPending: false };
const move = { mutate: vi.fn(), isPending: false };

const position = vi.fn();
vi.mock("../hooks", () => ({
  useConfirmReceipt: () => confirm,
  useMarkArrived: () => arrive,
  useOnMyWay: () => onMyWay,
  useRunningLate: () => late,
  currentPosition: () => position(),
}));
vi.mock("@/features/deals/hooks", () => ({ useMoveStatus: () => move }));

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "d1",
    dealNumber: "A1B2C3",
    contactId: "c1",
    clientType: ClientType.RESIDENTIAL,
    serviceArea: "CT",
    address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" },
    jobTypeId: "jt1",
    superStatus: JobSuperStatus.SUBMITTED,
    assignedTechIds: ["t1"],
    assignedDispatcherId: "u1",
    priority: DealPriority.NORMAL,
    tagIds: [],
    status: DealStatus.ACTIVE,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

/**
 * The visit's steps as one more row of the job page's grey band, under
 * "Job name:", "Status:" and "Tags:" — "Visit:" and Workiz's 32px outline
 * pills, each step's stamp in the row's 13px ink once it has happened.
 */
describe("TechActions — the Visit row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockReturnValue(true);
    position.mockResolvedValue({ lat: 41.76, lng: -72.67, accuracy: 12 });
  });

  it("is a header row: 'Visit:' and the whole flow as pills on a fresh submitted job", () => {
    render(<TechActions deal={deal()} />);

    expect(screen.getByText("Visit:")).toBeInTheDocument();
    for (const name of ["Confirm receipt", "On my way", "Running late", "Arrived", "Start job"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Job Done/ })).not.toBeInTheDocument();
  });

  it("replaces a step with its stamp once it has happened", () => {
    render(
      <TechActions
        deal={deal({
          superStatus: JobSuperStatus.IN_PROGRESS,
          techConfirmedAt: "2026-09-16T13:05:00.000Z",
          arrivedAt: "2026-09-16T13:40:00.000Z",
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Confirm receipt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Arrived/ })).not.toBeInTheDocument();
    expect(screen.getByText(/^Confirmed at /)).toBeInTheDocument();
    expect(screen.getByText(/^Arrived at /)).toBeInTheDocument();
    // In progress is where Workiz's "Job Done" becomes the next thing to do.
    expect(screen.getByRole("button", { name: /^Job Done/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Start job/ })).not.toBeInTheDocument();
  });

  it("draws no row at all on a closed job nobody confirmed or reached", () => {
    render(<TechActions deal={deal({ superStatus: JobSuperStatus.DONE })} />);

    expect(screen.queryByText("Visit:")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps only the stamps on a closed job", () => {
    render(<TechActions deal={deal({ superStatus: JobSuperStatus.DONE, arrivedAt: "2026-09-16T13:40:00.000Z" })} />);

    expect(screen.getByText("Visit:")).toBeInTheDocument();
    expect(screen.getByText(/^Arrived at /)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("confirms receipt on a tap", async () => {
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Confirm receipt/ }));
    expect(confirm.mutate).toHaveBeenCalled();
  });

  it("texts the client 'On my way' on a tap", async () => {
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByRole("button", { name: /^On my way/ }));
    expect(onMyWay.mutate).toHaveBeenCalledWith(undefined);
  });

  it("asks the phone where it is before recording an arrival", async () => {
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Arrived/ }));

    await vi.waitFor(() =>
      expect(arrive.mutate).toHaveBeenCalledWith({ lat: 41.76, lng: -72.67, accuracy: 12 }),
    );
  });

  it("still records the arrival when the phone refuses its location", async () => {
    position.mockResolvedValue(undefined);
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Arrived/ }));

    await vi.waitFor(() => expect(arrive.mutate).toHaveBeenCalledWith({}));
  });

  it("asks how late, in Workiz's small menu, before texting the client", async () => {
    render(<TechActions deal={deal()} />);

    expect(screen.queryByRole("menuitem", { name: "30 min" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Running late/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "30 min" }));

    expect(late.mutate).toHaveBeenCalledWith(30);
  });

  it("moves the status with the existing transition endpoint", async () => {
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Start job/ }));

    expect(move.mutate).toHaveBeenCalledWith({ superStatus: JobSuperStatus.IN_PROGRESS });
  });

  it("finishes the job with Job Done", async () => {
    render(<TechActions deal={deal({ superStatus: JobSuperStatus.IN_PROGRESS })} />);
    await userEvent.click(screen.getByRole("button", { name: /^Job Done/ }));

    expect(move.mutate).toHaveBeenCalledWith({ superStatus: JobSuperStatus.DONE });
  });

  it("hides the texts from somebody who may not send messages, and the moves from somebody who may not", () => {
    can.mockImplementation((resource: string) => resource !== "messages" && resource !== "deals");
    render(<TechActions deal={deal()} />);

    expect(screen.queryByRole("button", { name: /^On my way/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Start job/ })).not.toBeInTheDocument();
    // Confirming and arriving are not messages — they stay.
    expect(screen.getByRole("button", { name: /^Confirm receipt/ })).toBeInTheDocument();
  });
});
