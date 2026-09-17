import { describe, it, expect } from "vitest";
import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AUTOMATION_TEMPLATES } from "../templates";
import { messageSegments, segmentsToBody } from "../lib";
import {
  AutomationMessageEditor,
  serializeMessage,
  type MessageEditorHandle,
} from "./automation-message-editor";

/** The editor as the dialog drives it: a controlled value plus the insert handle. */
function Harness({
  initial = "",
  replacement = "",
  onValue,
}: {
  initial?: string;
  /** What the "Replace" button sets the value to — a template applied over the top. */
  replacement?: string;
  onValue?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const handle = useRef<MessageEditorHandle>(null);
  return (
    <div>
      <span id="msg-label">Message</span>
      <button type="button" onClick={() => handle.current?.insertCode("job_date")}>
        Insert
      </button>
      <button type="button" onClick={() => setValue(replacement)}>
        Replace
      </button>
      <AutomationMessageEditor
        ref={handle}
        labelledBy="msg-label"
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
      />
      <output data-testid="value">{value}</output>
    </div>
  );
}

const editor = () => screen.getByRole("textbox", { name: "Message" });
const value = () => screen.getByTestId("value").textContent;
const chips = () => Array.from(editor().querySelectorAll("[data-short-code]"));

/** Put the caret where a person would have clicked. */
function caretAt(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Highlight a stretch of the message, as a drag across it would. */
function selectFrom(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("AutomationMessageEditor", () => {
  it("is a labelled multiline text field", () => {
    render(<Harness initial="Hi" />);
    const box = editor();
    expect(box).toHaveAttribute("aria-multiline", "true");
    expect(box).toHaveAttribute("contenteditable", "true");
    // Reachable by Tab, so a whole message can be written without a mouse.
    expect(box).toHaveAttribute("tabindex", "0");
  });

  it("draws each short code as one atomic chip and leaves the text alone", () => {
    render(<Harness initial="Hi {{first_name}}, job {{job_id}} on {{job_date}}." />);

    expect(chips().map((c) => c.textContent)).toEqual(["{{first_name}}", "{{job_id}}", "{{job_date}}"]);
    for (const chip of chips()) expect(chip).toHaveAttribute("contenteditable", "false");
    expect(editor().textContent).toBe("Hi {{first_name}}, job {{job_id}} on {{job_date}}.");
  });

  it("deletes a whole variable on Backspace, not a character of it", () => {
    render(<Harness initial="Hi {{first_name}}!" />);

    caretAt(editor().childNodes[2], 0);
    fireEvent.keyDown(editor(), { key: "Backspace" });

    expect(chips()).toHaveLength(0);
    expect(value()).toBe("Hi !");
  });

  it("deletes it on Delete from the other side too", () => {
    render(<Harness initial="Hi {{first_name}}!" />);

    caretAt(editor().childNodes[0], 3);
    fireEvent.keyDown(editor(), { key: "Delete" });

    expect(chips()).toHaveLength(0);
    expect(value()).toBe("Hi !");
  });

  it("leaves an ordinary Backspace to the browser", () => {
    render(<Harness initial="Hi {{first_name}}!" />);
    caretAt(editor().childNodes[0], 2);
    const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    editor().dispatchEvent(event);
    // Nothing next to a chip: the box handles its own text.
    expect(event.defaultPrevented).toBe(false);
    expect(chips()).toHaveLength(1);
  });

  it("inserts a short code where the caret is, and serialises it as the renderer wants it", async () => {
    const user = userEvent.setup();
    render(<Harness initial="Hi there" />);

    caretAt(editor().childNodes[0], 2);
    fireEvent.keyUp(editor(), { key: "ArrowLeft" });
    await user.click(screen.getByRole("button", { name: "Insert" }));

    expect(value()).toBe("Hi{{job_date}} there");
    expect(chips()).toHaveLength(1);
  });

  it("appends the code when nothing has been clicked yet", async () => {
    const user = userEvent.setup();
    render(<Harness initial="Hi there " />);

    await user.click(screen.getByRole("button", { name: "Insert" }));
    expect(value()).toBe("Hi there {{job_date}}");
  });

  it("writes a newline on Enter rather than the browser's own markup", () => {
    render(<Harness initial="One" />);
    caretAt(editor().childNodes[0], 3);
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(value()).toBe("One\n");
    expect(editor().querySelector("div")).toBeNull();
  });

  it("pastes as plain text, newlines kept and markup dropped", () => {
    render(<Harness initial="" />);
    fireEvent.paste(editor(), {
      clipboardData: { getData: (type: string) => (type === "text/plain" ? "a\nb" : "<b>a</b>") },
    });
    expect(value()).toBe("a\nb");
  });

  it("replaces the highlighted words rather than pasting beside them", () => {
    render(<Harness initial="One two three" />);
    selectFrom(editor().childNodes[0], 4, editor().childNodes[0], 7);
    fireEvent.mouseUp(editor());
    fireEvent.paste(editor(), { clipboardData: { getData: () => "TWO" } });

    expect(value()).toBe("One TWO three");
  });

  it("replaces the highlighted words on Enter too", () => {
    render(<Harness initial="One two three" />);
    selectFrom(editor().childNodes[0], 4, editor().childNodes[0], 7);
    fireEvent.mouseUp(editor());
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(value()).toBe("One \n three");
  });

  it("takes a half-selected variable whole, never a fragment of one", () => {
    render(<Harness initial="Hi {{first_name}} there" />);
    const root = editor();
    // From inside the first text run to halfway through the chip's own text:
    // a chip left with three of its characters gone would still serialise as
    // the whole `{{first_name}}` and read as nonsense on screen.
    selectFrom(root.childNodes[0], 3, root.childNodes[1].firstChild!, 5);
    fireEvent.mouseUp(root);
    fireEvent.paste(root, { clipboardData: { getData: () => "Bob" } });

    expect(value()).toBe("Hi Bob there");
    expect(chips()).toHaveLength(0);
  });

  it("repaints when the value is changed from outside", async () => {
    const user = userEvent.setup();
    render(<Harness initial="First {{job_id}}" replacement="Second {{job_date}} and {{biz_name}}" />);
    expect(chips().map((c) => c.textContent)).toEqual(["{{job_id}}"]);

    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(editor().textContent).toBe("Second {{job_date}} and {{biz_name}}");
    expect(chips().map((c) => c.textContent)).toEqual(["{{job_date}}", "{{biz_name}}"]);
  });

  it("round-trips every body the recipe library ships", () => {
    for (const body of AUTOMATION_TEMPLATES.flatMap((t) => t.draft.spec.actions.map((a) => a.body ?? ""))) {
      const { unmount } = render(<Harness initial={body} />);
      expect(editor().textContent).toBe(body);
      expect(serializeMessage(editor())).toBe(body);
      unmount();
    }
  });
});

describe("serializeMessage", () => {
  it("reads back exactly what the paint put in", () => {
    const body = "Hi {{first_name}}\nBye — {{ job_date }}";
    render(<Harness initial={body} />);
    expect(serializeMessage(editor())).toBe(body);
    expect(segmentsToBody(messageSegments(body))).toBe(body);
  });

  it("drops the trailing break a browser parks in an emptied box", () => {
    render(<Harness initial="Hi" />);
    const box = editor();
    box.appendChild(document.createElement("br"));
    expect(serializeMessage(box)).toBe("Hi");
    // A break in the middle is a real newline, not decoration.
    box.insertBefore(document.createElement("br"), box.firstChild);
    expect(serializeMessage(box)).toBe("\nHi");
  });
});
