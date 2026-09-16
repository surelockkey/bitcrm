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

describe("TechActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockReturnValue(true);
    position.mockResolvedValue({ lat: 41.76, lng: -72.67, accuracy: 12 });
  });

  it("offers the whole flow on a fresh submitted job", () => {
    render(<TechActions deal={deal()} />);

    expect(screen.getByTestId("tech-confirm")).toBeInTheDocument();
    expect(screen.getByTestId("tech-on-my-way")).toBeInTheDocument();
    expect(screen.getByTestId("tech-late")).toBeInTheDocument();
    expect(screen.getByTestId("tech-arrived")).toBeInTheDocument();
    expect(screen.getByTestId("tech-start")).toBeInTheDocument();
    expect(screen.queryByTestId("tech-done")).not.toBeInTheDocument();
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

    expect(screen.queryByTestId("tech-confirm")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tech-arrived")).not.toBeInTheDocument();
    expect(screen.getByText(/^Confirmed at /)).toBeInTheDocument();
    expect(screen.getByText(/^Arrived at /)).toBeInTheDocument();
    // In progress is where "Done" becomes the next thing to do.
    expect(screen.getByTestId("tech-done")).toBeInTheDocument();
    expect(screen.queryByTestId("tech-start")).not.toBeInTheDocument();
  });

  it("offers nothing but the stamps on a closed job", () => {
    render(<TechActions deal={deal({ superStatus: JobSuperStatus.DONE })} />);

    expect(screen.queryByTestId("tech-confirm")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tech-on-my-way")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tech-arrived")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tech-done")).not.toBeInTheDocument();
  });

  it("confirms receipt on a tap", async () => {
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByTestId("tech-confirm"));
    expect(confirm.mutate).toHaveBeenCalled();
  });

  it("asks the phone where it is before recording an arrival", async () => {
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByTestId("tech-arrived"));

    await vi.waitFor(() =>
      expect(arrive.mutate).toHaveBeenCalledWith({ lat: 41.76, lng: -72.67, accuracy: 12 }),
    );
  });

  it("still records the arrival when the phone refuses its location", async () => {
    position.mockResolvedValue(undefined);
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByTestId("tech-arrived"));

    await vi.waitFor(() => expect(arrive.mutate).toHaveBeenCalledWith({}));
  });

  it("asks how late before texting the client", async () => {
    render(<TechActions deal={deal()} />);

    expect(screen.queryByTestId("tech-late-choices")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("tech-late"));
    await userEvent.click(screen.getByRole("button", { name: "30 min" }));

    expect(late.mutate).toHaveBeenCalledWith(30);
  });

  it("moves the status with the existing transition endpoint", async () => {
    render(<TechActions deal={deal()} />);
    await userEvent.click(screen.getByTestId("tech-start"));

    expect(move.mutate).toHaveBeenCalledWith({ superStatus: JobSuperStatus.IN_PROGRESS });
  });

  it("hides the texts from somebody who may not send messages, and the moves from somebody who may not", () => {
    can.mockImplementation((resource: string) => resource !== "messages" && resource !== "deals");
    render(<TechActions deal={deal()} />);

    expect(screen.queryByTestId("tech-on-my-way")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tech-start")).not.toBeInTheDocument();
    // Confirming and arriving are not messages — they stay.
    expect(screen.getByTestId("tech-confirm")).toBeInTheDocument();
  });
});
