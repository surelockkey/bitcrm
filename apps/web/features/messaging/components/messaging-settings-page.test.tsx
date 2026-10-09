import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeServer, renderWithClient, type FakeRoute } from "@/test/page-load";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/calls/texting",
  useSearchParams: () => new URLSearchParams(),
}));
const perms = vi.hoisted(() => ({ settings: true, templates: true }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string) => (resource === "settings" ? !perms.settings : false),
  usePermissions: () => ({
    can: (resource: string) => (resource === "settings" ? perms.settings : resource === "message_templates" ? perms.templates : true),
    isTechnician: false,
    isLoading: false,
    me: { id: "me" },
  }),
}));

const saved = vi.hoisted(() => ({ bodies: [] as unknown[] }));
const routes: FakeRoute[] = [
  {
    match: /\/messaging\/settings$/,
    method: "PUT",
    reply: (_url, init) => {
      saved.bodies.push(JSON.parse(String(init?.body)));
      return {};
    },
  },
  {
    match: /\/messaging\/settings$/,
    reply: () => ({ defaultSenderNumber: "+14045550100", smsFormat: "New job #{{job_id}}", onMyWayMsg: "Hi", lateMsg: "Late" }),
  },
  { match: /\/telephony\/numbers$/, reply: () => [{ sid: "PN1", phoneNumber: "+14045550100", friendlyName: "Main" }] },
  {
    match: /\/messaging\/templates\/short-codes$/,
    reply: () => [
      { code: "job_id", group: "job", description: "Job id", example: "1" },
      { code: "first_name", group: "client", description: "First name", example: "Jane" },
    ],
  },
  {
    match: /\/messaging\/templates$/,
    reply: () => [
      { id: "t1", messageTemplateTitle: "On our way", messageTemplate: "<p>Hi</p>", channel: "sms", isDefault: false, active: true },
    ],
  },
];


const { MessagingSettingsPage } = await import("./messaging-settings-page");
const renderPage = () => renderWithClient(<TooltipProvider><MessagingSettingsPage /></TooltipProvider>);

beforeEach(() => {
  perms.settings = true;
  perms.templates = true;
  saved.bodies.length = 0;
  installFakeServer(routes);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Workiz Phone → Texting (pg_settings_phone_wz_texting): one 568px column of
 * sections — Messaging compliance, Messaging settings, Text templates — and
 * "Save Settings" in the bar at the bottom. Ours fill Workiz's sections with
 * what they hold (STOP/HELP is compliance, the sender and quiet hours are
 * messaging settings, the tech texts and our templates are text templates)
 * and add Business profile after them.
 */
describe("MessagingSettingsPage — Workiz's Texting tab", () => {
  it("draws Workiz's sections in Workiz's order, ours after them", async () => {
    renderPage();
    await screen.findByText("Messaging compliance", {}, { timeout: 3000 });
    const sections = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(sections).toEqual(["Messaging compliance", "Messaging settings", "Text templates", "Business profile"]);
    expect(screen.getByRole("button", { name: "Save Settings" })).toBeInTheDocument();
  });

  it("names the tech texts as Workiz does and offers their short codes", async () => {
    renderPage();
    expect(await screen.findByRole("textbox", { name: "Job Text Message" }, { timeout: 3000 })).toHaveValue("New job #{{job_id}}");
    expect(screen.getByRole("textbox", { name: "On the Way" })).toHaveValue("Hi");
    expect(screen.getByRole("textbox", { name: "Running late" })).toHaveValue("Late");
    expect(screen.getByRole("group", { name: "Short codes for Job Text Message" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enable Job Closing" })).toBeInTheDocument();
  });

  it("keeps the templates under Text templates", async () => {
    renderPage();
    expect(await screen.findByRole("list", { name: "Quick replies" }, { timeout: 3000 })).toHaveTextContent("On our way");
  });

  it("saves the edits through Save Settings", async () => {
    const u = userEvent.setup();
    renderPage();
    const box = await screen.findByRole("textbox", { name: "Running late" }, { timeout: 3000 });
    await u.type(box, " again");
    await u.click(screen.getByRole("button", { name: "Save Settings" }));
    await waitFor(() => expect(saved.bodies).toHaveLength(1));
    expect(saved.bodies[0]).toMatchObject({ lateMsg: "Late again" });
  });

  it("shows a reader who may only see templates the templates, and no Save", async () => {
    perms.settings = false;
    renderPage();
    expect(await screen.findByRole("list", { name: "Quick replies" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Job Text Message" })).not.toBeInTheDocument();
  });

  it("refuses a reader who may see neither", async () => {
    perms.settings = false;
    perms.templates = false;
    renderPage();
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });
});
