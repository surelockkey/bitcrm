import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { JobSuperStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";
import { CALL_ALERT_BODY, NOTIFICATION_CATEGORY, toSpec } from "../lib";
import { NotificationsPage } from "./notifications-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

const perms = vi.hoisted(() => ({ canEdit: true }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (_r: string, action?: string) => (action === "edit" ? perms.canEdit : true),
    me: { id: "me" },
    isLoading: false,
    isTechnician: false,
  }),
}));

const stamp = { createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z" };

const rules = [
  {
    id: "tech",
    name: "Tech reminder / 1 hour before",
    enabled: false,
    category: NOTIFICATION_CATEGORY,
    spec: toSpec({
      kind: "tech_reminder",
      notifyBy: "sms",
      triggerBy: "time",
      amount: 1,
      unit: "hours",
      subject: "Appointment reminder",
      body: "Service appointment reminder",
    }),
    ...stamp,
  },
  {
    id: "client",
    name: "Client reminder / 1 hour before",
    enabled: true,
    category: NOTIFICATION_CATEGORY,
    spec: toSpec({
      kind: "client_reminder",
      notifyBy: "email",
      triggerBy: "time",
      amount: 1,
      unit: "hours",
      subject: "Your appointment",
      body: "Greetings {{full_name}}",
    }),
    ...stamp,
  },
  {
    id: "missed",
    name: "Call alert / Missed",
    enabled: false,
    category: NOTIFICATION_CATEGORY,
    spec: toSpec({ kind: "call_alert", notifyBy: "sms", callStatus: "missed", userIds: ["u1"] }),
    ...stamp,
  },
  {
    id: "done",
    name: "Job status alert / Job Done",
    enabled: false,
    category: NOTIFICATION_CATEGORY,
    spec: toSpec({ kind: "user_status_alert", notifyBy: "both", status: { subStatusId: "s1" }, rules: [], userIds: ["u1"] }),
    ...stamp,
  },
  // Filed under the category but said by none of the four forms: not listed.
  {
    id: "webhook",
    name: "Webhook",
    enabled: false,
    category: NOTIFICATION_CATEGORY,
    spec: { version: 1, trigger: { kind: "deal.created" }, actions: [{ type: "webhook", url: "https://x" }] },
    ...stamp,
  },
  // Another category: not this page's.
  {
    id: "other",
    name: "Canceled job & techs",
    enabled: true,
    category: "job",
    spec: {
      version: 1,
      trigger: { kind: "deal.status_changed", to: ["canceled"] },
      actions: [{ type: "send_sms", to: "assigned_techs", body: "x" }],
    },
    ...stamp,
  },
];

const users = [
  {
    id: "u1",
    firstName: "System",
    lastName: "admin",
    email: "system.admin@surelockkey.com",
    roleId: "role-admin",
    status: "active",
    fieldTeamMember: false,
    ...stamp,
  },
  {
    id: "u2",
    firstName: "Dana",
    lastName: "Ruiz",
    email: "dana@example.com",
    roleId: "role-technician",
    status: "active",
    fieldTeamMember: true,
    ...stamp,
  },
];

const statuses = [
  { id: "s1", name: "Job Done", group: JobSuperStatus.IN_PROGRESS, color: "blue", priority: 1, active: true, createdBy: "me", ...stamp },
];

const patched: Array<{ id: string; body: unknown }> = [];
const created: unknown[] = [];
const deleted: string[] = [];
let requestedCategory: string | null = null;

beforeEach(() => {
  perms.canEdit = true;
  patched.length = 0;
  created.length = 0;
  deleted.length = 0;
  requestedCategory = null;
  server.use(
    http.get("*/messaging/automations", ({ request }) => {
      requestedCategory = new URL(request.url).searchParams.get("category");
      return HttpResponse.json({ success: true, data: rules });
    }),
    http.patch("*/messaging/automations/:id", async ({ params, request }) => {
      const body = await request.json();
      patched.push({ id: String(params.id), body });
      const rule = rules.find((r) => r.id === params.id);
      return HttpResponse.json({ success: true, data: { ...rule, ...(body as object) } });
    }),
    http.post("*/messaging/automations", async ({ request }) => {
      const body = await request.json();
      created.push(body);
      return HttpResponse.json({ success: true, data: { id: "new", ...(body as object), ...stamp } });
    }),
    http.delete("*/messaging/automations/:id", ({ params }) => {
      deleted.push(String(params.id));
      return HttpResponse.json({ success: true, data: { id: String(params.id) } });
    }),
    http.get("*/users", () => HttpResponse.json({ success: true, data: users, pagination: { count: users.length } })),
    http.get("*/deals/job-statuses", () => HttpResponse.json({ success: true, data: statuses })),
    http.get("*/deals/job-sources", () =>
      HttpResponse.json({ success: true, data: [{ id: "src1", name: "Yelp", priority: 1, active: true, ...stamp }] }),
    ),
    http.get("*/deals/job-types", () =>
      HttpResponse.json({ success: true, data: [{ id: "jt1", name: "Rekey", priority: 1, active: true, ...stamp }] }),
    ),
    http.get("*/deals/service-areas", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/messaging/templates/short-codes", () =>
      HttpResponse.json({
        success: true,
        data: [
          { code: "job_id", group: "job", description: "", example: "" },
          { code: "full_name", group: "client", description: "", example: "" },
          { code: "tech_phone", group: "technician", description: "", example: "" },
        ],
      }),
    ),
  );
});

const renderPage = async () => {
  renderWithClient(<NotificationsPage />);
  await screen.findByText("Notify tech by SMS 1 Hours before appointment");
};

describe("the Notifications page", () => {
  it("asks for the notification category and lists only what the four forms can say, in Workiz's words", async () => {
    await renderPage();
    expect(requestedCategory).toBe("notification");
    const grid = screen.getByRole("table", { name: "Auto notifications" });
    const text = grid.textContent ?? "";
    expect(text).toContain("Assigned tech");
    expect(text).toContain("Assigned client");
    expect(text).toContain("Notify client by Email 1 Hours before appointment");
    expect(text).toContain("Notify System admin when call is Missed and assigned to Any Flow");
    expect(text).toContain("Notify System admin by SMS and Email when job status is Job Done");
    expect(text).toContain("system.admin@surelockkey.com");
    expect(screen.queryByText("Webhook")).not.toBeInTheDocument();
    expect(screen.queryByText(/Canceled job/)).not.toBeInTheDocument();
    // The status and the flow in bold, as Workiz prints them.
    expect(within(grid).getByText("Missed").tagName).toBe("B");
    expect(within(grid).getByText("Any Flow").tagName).toBe("B");
    expect(within(grid).getByText("Job Done").tagName).toBe("B");
    // Notify By: SMS / Email / Both.
    expect(within(grid).getAllByText("SMS").length).toBeGreaterThan(0);
    expect(within(grid).getByText("Email")).toBeInTheDocument();
    expect(within(grid).getByText("Both")).toBeInTheDocument();
    // Workiz's footer words.
    expect(screen.getByText("Showing 1 to 4 of 4 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("switches a row on and off through PATCH", async () => {
    await renderPage();
    const toggle = screen.getByRole("switch", { name: /Notify tech by SMS 1 Hours before appointment/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(patched).toEqual([{ id: "tech", body: { enabled: true } }]));
  });

  it("asks before the trash deletes", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Delete: Notify tech by SMS/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete this notification?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toEqual(["tech"]));
  });

  it("opens a row in its kind's form, filled in", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("Notify client by Email 1 Hours before appointment"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Edit notification")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Who to notify" })).toBeInTheDocument();
    expect(within(dialog).getByText("Assigned client")).toBeInTheDocument();
    expect(within(dialog).getByText("Email")).toBeInTheDocument();
    expect(within(dialog).getByText("Time")).toBeInTheDocument();
    expect(within(dialog).getByText("Before job start")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Subject")).toHaveValue("Your appointment");
    expect(within(dialog).getByLabelText("Message")).toHaveValue("Greetings {{full_name}}");
    // The client's short codes, as chips.
    expect(within(dialog).getByRole("button", { name: "Full Name" })).toBeInTheDocument();
  });

  it("saves an edited reminder as the compiled spec, keeping its kind", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("Notify tech by SMS 1 Hours before appointment"));
    const dialog = await screen.findByRole("dialog");
    const message = within(dialog).getByLabelText("Message");
    fireEvent.change(message, { target: { value: "Reminder: {{job_id}}" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({
      id: "tech",
      body: {
        name: "Tech reminder / 1 hour before",
        notificationKind: "tech_reminder",
        spec: toSpec({
          kind: "tech_reminder",
          notifyBy: "sms",
          triggerBy: "time",
          amount: 1,
          unit: "hours",
          subject: "Appointment reminder",
          body: "Reminder: {{job_id}}",
        }),
      },
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("creates a call alert from Add New, off, under the notification category", async () => {
    const user = userEvent.setup();
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add New" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add new notification")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Select notification type, notifications can be sent to clients, techs and users"),
    ).toBeInTheDocument();

    // Nothing chosen: Save refuses.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Choose who to notify");

    await user.click(within(dialog).getByRole("combobox", { name: "Who to notify" }));
    const list = await screen.findByRole("listbox");
    // Workiz's menu: the three kinds, the heading, then every active user.
    expect(within(list).getByText("Custom notification to User:")).toBeInTheDocument();
    expect(within(list).getByText("System admin (system.admin@surelockkey.com)")).toBeInTheDocument();
    await user.click(within(list).getByText("When a call comes in"));

    expect(within(dialog).getByText("When call is")).toBeInTheDocument();
    expect(within(dialog).getByText("From Call Flow")).toBeInTheDocument();
    expect(within(dialog).getByText("Any Flow")).toBeInTheDocument();
    // Nobody to notify yet.
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Choose who to notify");

    await user.click(within(dialog).getByRole("combobox", { name: "Notify" }));
    await user.click(await screen.findByRole("option", { name: "Dana Ruiz" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      name: "Call alert / Completed",
      enabled: false,
      category: NOTIFICATION_CATEGORY,
      notificationKind: "call_alert",
      spec: {
        version: 1,
        trigger: { kind: "call.completed", callOutcome: "answered", callDirection: "inbound" },
        conditions: [],
        actions: [{ type: "send_sms", to: "users", userIds: ["u2"], body: CALL_ALERT_BODY }],
      },
    });
  });

  it("builds a status alert to a user with an And rule", async () => {
    const user = userEvent.setup();
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add New" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Who to notify" }));
    await user.click(await screen.findByText("System admin (system.admin@surelockkey.com)"));
    // Workiz's defaults: Both, Submitted.
    expect(within(dialog).getByText("Both")).toBeInTheDocument();
    expect(within(dialog).getByText("When Job Status")).toBeInTheDocument();
    expect(within(dialog).getByText("Submitted")).toBeInTheDocument();
    expect(within(dialog).queryByText("And")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Add Rule" }));
    expect(within(dialog).getByText("And")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("combobox", { name: "Choose Parameter" }));
    const params = await screen.findByRole("listbox");
    expect(within(params).getByText("External Company — coming later")).toBeInTheDocument();
    await user.click(within(params).getByText("Ad Group"));
    await user.click(within(dialog).getByRole("combobox", { name: "Ad Group" }));
    await user.click(await screen.findByRole("option", { name: "Yelp" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: "Job status alert / Submitted",
      notificationKind: "user_status_alert",
      spec: {
        trigger: { kind: "deal.status_changed", to: [JobSuperStatus.SUBMITTED] },
        conditions: [{ field: "source", op: "in", values: ["src1"], labels: ["Yelp"] }],
        actions: [
          { type: "send_sms", to: "users", userIds: ["u1"] },
          { type: "send_email", to: "users", userIds: ["u1"] },
        ],
      },
    });
  });

  it("shows no Add New, a locked trash and locked switches to a reader who may not edit", async () => {
    perms.canEdit = false;
    await renderPage();
    expect(screen.queryByRole("button", { name: "Add New" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Delete: Notify tech/ })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Notify tech by SMS/ })).toBeDisabled();
  });
});
