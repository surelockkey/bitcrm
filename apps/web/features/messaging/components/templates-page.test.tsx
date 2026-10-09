import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { MessageTemplatesSection } from "./templates-page";

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));

const template = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  messageTemplateTitle: `Template ${id}`,
  messageTemplate: `<p>Hi {{first_name}} (${id}) &amp; co</p>`,
  channel: "sms",
  isDefault: false,
  active: true,
  createdBy: "u",
  createdAt: "x",
  updatedAt: "x",
  ...extra,
});

const archived: string[] = [];
const created: unknown[] = [];

beforeEach(() => {
  archived.length = 0;
  created.length = 0;
  server.use(
    http.get("*/messaging/templates", ({ request }) => {
      expect(new URL(request.url).searchParams.get("includeInactive")).toBe("true");
      return HttpResponse.json({
        success: true,
        data: [template("a", { isDefault: true, category: "Dispatch" }), template("b", { active: false })],
      });
    }),
    http.delete("*/messaging/templates/:id", ({ params }) => {
      archived.push(String(params.id));
      return HttpResponse.json({ success: true, data: { id: params.id, archived: true, deleted: false } });
    }),
    http.post("*/messaging/templates", async ({ request }) => {
      created.push(await request.json());
      return HttpResponse.json({ success: true, data: template("c") });
    }),
    http.post("*/messaging/templates/preview", async ({ request }) => {
      const body = (await request.json()) as { body: string };
      return HttpResponse.json({ success: true, data: { body: body.body.replace("{{first_name}}", "Jane"), missing: [] } });
    }),
    http.get("*/messaging/templates/short-codes", () =>
      HttpResponse.json({
        success: true,
        data: [{ code: "first_name", group: "client", description: "First name", example: "Jane" }],
      }),
    ),
  );
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MessageTemplatesSection />
    </QueryClientProvider>,
  );
}

/**
 * Our message templates are Workiz's quick replies (the inbox's "Quick reply"
 * list with "+ New template"); they are kept on the Texting tab under "Text
 * templates", drawn as Workiz's quick-reply rows.
 */
describe("MessageTemplatesSection", () => {
  it("lists active and archived templates as Workiz's quick-reply rows, with our marks", async () => {
    renderSection();
    const list = await screen.findByRole("list", { name: "Quick replies" });
    expect(within(list).getByText("Template a")).toBeInTheDocument();
    // The text without Workiz's HTML: no tags, no "&amp;".
    expect(within(list).getByText("Hi {{first_name}} (a) & co")).toBeInTheDocument();
    expect(within(list).getByText("Default")).toBeInTheDocument();
    expect(within(list).getByText(/Dispatch/)).toBeInTheDocument();
    expect(within(list).getByText("Archived")).toBeInTheDocument();
    // Archived rows offer restore / delete, active rows offer archive.
    expect(screen.getByRole("button", { name: "Archive Template a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Template b" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Template b" })).toBeInTheDocument();
  });

  it("archives a template", async () => {
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Archive Template a" }));
    await waitFor(() => expect(archived).toEqual(["a"]));
  });

  it("creates a template from Workiz's + New template, with a preview on the way", async () => {
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "New template" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("New template");

    await userEvent.type(screen.getByLabelText("Title"), "Running late");
    // Pasted: user-event treats "{{" as an escape when typing.
    await userEvent.click(screen.getByLabelText("Message"));
    await userEvent.paste("Hi {{first_name}}, running late");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByTestId("template-preview")).toHaveTextContent("Hi Jane, running late");

    await userEvent.click(screen.getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      messageTemplateTitle: "Running late",
      messageTemplate: "Hi {{first_name}}, running late",
      channel: "sms",
      isDefault: false,
      active: true,
    });
  });
});
