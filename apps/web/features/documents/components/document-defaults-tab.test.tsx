import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { DEFAULT_DOCUMENT_SETTINGS } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DocumentDefaultsTab } from "./document-defaults-tab";
import { DocumentMessagesTab } from "./document-messages-tab";

let saved: Record<string, unknown> | undefined;
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  saved = undefined;
  server.use(
    http.get("*/billing/document-settings", () =>
      HttpResponse.json({ success: true, data: { ...DEFAULT_DOCUMENT_SETTINGS, depositPercentage: 50 } }),
    ),
    http.put("*/billing/document-settings", async ({ request }) => {
      saved = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ success: true, data: { ...DEFAULT_DOCUMENT_SETTINGS, ...saved } });
    }),
  );
});

describe("DocumentDefaultsTab (Workiz defaults)", () => {
  it("shows the Workiz default notes, the default deposit and the signature switch, and saves only what changed", async () => {
    renderWithClient(<DocumentDefaultsTab canEdit />);
    const estimateNotes = await screen.findByLabelText(/estimate notes/i);
    expect(estimateNotes).toHaveValue("Thank you for considering our services!");
    expect(screen.getByLabelText(/invoice notes/i)).toHaveValue("Thank you for considering our services!");
    expect(screen.getByLabelText("Deposit amount")).toHaveValue(50);
    expect(screen.getByRole("switch", { name: /request a signature on invoices/i })).toBeChecked();

    await user().clear(estimateNotes);
    await user().type(estimateNotes, "Thanks!");
    await user().click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved).toEqual({ estimateNotes: "Thanks!" }));
    expect(toast.success).toHaveBeenCalled();
  });

  it("a deposit as a fixed amount clears the percent", async () => {
    renderWithClient(<DocumentDefaultsTab canEdit />);
    await screen.findByLabelText(/estimate notes/i);
    await user().click(screen.getByRole("radio", { name: "$" }));
    const amount = screen.getByLabelText("Deposit amount");
    await user().clear(amount);
    await user().type(amount, "75");
    await user().click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved).toEqual({ depositAmount: 75, depositPercentage: null }));
  });

  it("is read-only without the edit permission", async () => {
    renderWithClient(<DocumentDefaultsTab canEdit={false} />);
    expect(await screen.findByLabelText(/estimate notes/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });
});

describe("DocumentMessagesTab (Workiz Email options)", () => {
  it("edits the subject and message per document and refuses to drop the portal link", async () => {
    renderWithClient(<DocumentMessagesTab canEdit />);
    const subject = await screen.findByLabelText(/invoice subject/i);
    expect(subject).toHaveValue("Your invoice from {{business.name}}");
    const message = screen.getByLabelText(/invoice message/i);
    await user().clear(message);
    await user().type(message, "Hi there");
    expect(screen.getByText(/must keep \{\{portal_link\}\}/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    await user().type(message, " {{{{portal_link}}");
    await user().click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved).toEqual({ invoiceMessage: "Hi there {{portal_link}}" }));
  });
});
