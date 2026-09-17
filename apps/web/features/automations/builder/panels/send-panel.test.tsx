import { describe, it, expect, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChainNode } from "../types";
import { renderNodePanel, serveCatalogs, settle } from "./panel-harness";

beforeEach(serveCatalogs);

const send = (action: ChainNode["action"]): ChainNode => ({ id: "s", kind: "send", action });
const jobTrigger: ChainNode = { id: "t", kind: "trigger", trigger: { kind: "deal.created" } };
const callTrigger: ChainNode = { id: "t", kind: "trigger", trigger: { kind: "call.completed" } };

describe("the send sentence", () => {
  it("reads 'Send the client a text message'", async () => {
    renderNodePanel(send({ type: "send_sms", to: "client" }), { chain: [jobTrigger, send({ type: "send_sms", to: "client" })] });
    await settle();

    expect(screen.getByLabelText("Who it goes to")).toHaveTextContent("the client");
    expect(screen.getByLabelText("How it goes out")).toHaveTextContent("a text message");
  });

  it("drops an email's subject when the channel stops having one", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_email", to: "client", subject: "Your job", body: "Hi" });
    const panel = renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    await user.click(screen.getByLabelText("How it goes out"));
    await user.click(screen.getByRole("option", { name: /a text message/ }));

    expect(panel.node().action).toEqual({ type: "send_sms", to: "client", body: "Hi" });
  });

  it("answers 'where is a text and email?' on the row rather than by hiding it", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_sms", to: "client" });
    renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    await user.click(screen.getByLabelText("How it goes out"));
    const both = screen.getByRole("option", { name: /a text and email/ });
    // Workiz's `notify_medium: both` is two actions in the spec and so two
    // steps in the chain; the row says which second step to add.
    expect(both).toHaveAttribute("aria-disabled", "true");
    expect(both).toHaveTextContent("add a second Send step for the email");
  });
});

describe("who it reaches", () => {
  it("says plainly that the dispatcher needs a job, and will not offer it on a call rule", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_sms", to: "client" });
    renderNodePanel(node, { chain: [callTrigger, node] });
    await settle();

    await user.click(screen.getByLabelText("Who it goes to"));
    const dispatcher = screen.getByRole("option", { name: /the dispatcher/ });
    expect(dispatcher).toHaveAttribute("aria-disabled", "true");
    expect(dispatcher).toHaveTextContent("only on a rule that has a job");
    expect(screen.getByRole("option", { name: /the assigned tech/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // Somebody to reach is still offered — the note is a redirection, not a dead end.
    expect(screen.getByRole("option", { name: /by role/ })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("warns about a rule that already reaches nobody", async () => {
    const node = send({ type: "send_sms", to: "dispatcher" });
    renderNodePanel(node, { chain: [callTrigger, node] });
    await settle();

    expect(screen.getByText(/would reach nobody/)).toBeInTheDocument();
  });

  it("opens the people picker for 'to user' and stores the ids", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_sms", to: "client" });
    const panel = renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    await user.click(screen.getByLabelText("Who it goes to"));
    await user.click(screen.getByRole("option", { name: /to user/ }));

    await user.click(await screen.findByLabelText("People to notify"));
    await user.click(await screen.findByRole("option", { name: "Ann Lee" }));

    expect(panel.node().action).toEqual({ type: "send_sms", to: "users", userIds: ["u1"] });
  });

  it("asks for a number when the recipient is one", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_sms", to: "number", number: "+14045551234" });
    const panel = renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    const box = screen.getByLabelText("Number");
    expect(box).toHaveValue("+14045551234");
    await user.clear(box);
    await user.type(box, "+15551112222");
    expect(panel.node().action?.number).toBe("+15551112222");
  });
});

describe("the message", () => {
  it("shows the first two lines and no more", async () => {
    const node = send({ type: "send_sms", to: "client", body: "One\nTwo\nThree\nFour" });
    renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    const shown = screen.getByText(/One/);
    expect(shown).toHaveTextContent("One Two");
    expect(shown).not.toHaveTextContent("Three");
  });

  it("opens the editor behind the button, with its variable chips, and writes through", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_sms", to: "client", body: "Hi {{first_name}}" });
    const panel = renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    await user.click(screen.getByRole("button", { name: /Preview\/edit message/ }));
    const box = await screen.findByRole("textbox", { name: "Message" });
    expect(box.querySelectorAll("[data-short-code]")).toHaveLength(1);

    await user.click(box);
    // A click in jsdom leaves the caret at the very start; put it where a
    // person clicking after the variable would have left it.
    const range = document.createRange();
    range.setStart(box, box.childNodes.length);
    range.collapse(true);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await user.keyboard("!");
    expect(panel.node().action?.body).toBe("Hi {{first_name}}!");

    // Closed and reopened, it shows what is saved rather than a stale draft.
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: /Preview\/edit message/ }));
    expect(await screen.findByRole("textbox", { name: "Message" })).toHaveTextContent(
      "Hi {{first_name}}!",
    );
  });

  it("asks for a subject inside the editor, and only for an email", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_email", to: "client", body: "Hi" });
    const panel = renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    await user.click(screen.getByRole("button", { name: /Preview\/edit message/ }));
    const subject = await screen.findByLabelText("Subject");
    await user.type(subject, "Your job");
    expect(panel.node().action?.subject).toBe("Your job");
  });

  it("keeps the subject out of a text message's editor", async () => {
    const user = userEvent.setup();
    const node = send({ type: "send_sms", to: "client", body: "Hi" });
    renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    await user.click(screen.getByRole("button", { name: /Preview\/edit message/ }));
    await screen.findByRole("textbox", { name: "Message" });
    expect(screen.queryByLabelText("Subject")).toBeNull();
  });
});

describe("when it goes out", () => {
  const when = () => within(screen.getByRole("heading", { name: "When" }).parentElement!);

  it("says 'immediately' when nothing holds it back", async () => {
    const node = send({ type: "send_sms", to: "client" });
    renderNodePanel(node, { chain: [jobTrigger, node] });
    await settle();

    expect(when().getByText("immediately")).toBeInTheDocument();
  });

  it("reads a Wait step above it rather than offering a second place to set one", async () => {
    const node = send({ type: "send_sms", to: "client" });
    const wait: ChainNode = { id: "w", kind: "wait", waitMinutes: 240 };
    renderNodePanel(node, { chain: [jobTrigger, wait, node] });
    await settle();

    expect(when().getByText("4 hours after the trigger")).toBeInTheDocument();
    expect(when().getByText(/set on the Wait step above/)).toBeInTheDocument();
  });

  it("reads a relative trigger as Workiz words it", async () => {
    const node = send({ type: "send_sms", to: "client" });
    const trigger: ChainNode = {
      id: "t",
      kind: "trigger",
      trigger: { kind: "schedule.relative", anchor: "scheduledStart", offsetMinutes: -240 },
    };
    renderNodePanel(node, { chain: [trigger, node] });
    await settle();

    expect(when().getByText("4 hours ahead of the job's start")).toBeInTheDocument();
  });
});
