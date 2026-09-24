import { describe, it, expect } from "vitest";
import { noteToHtml, noteToText, isHtmlNote } from "./note-html";

/**
 * The job note becomes a rich-text field, and the danger is the boundary.
 *
 * 79,708 imported notes are plain text with newlines. Opened in an editor that
 * speaks HTML they must arrive as paragraphs, not as one run-on line; and
 * every place that still shows a note as plain text — the jobs table, the
 * quick view — must show words, never tags.
 */
describe("noteToHtml", () => {
  it("makes a paragraph of each line, so an imported note keeps its shape", () => {
    expect(noteToHtml("#George / NP\nIgnition cylinder Change")).toBe(
      "<p>#George / NP</p><p>Ignition cylinder Change</p>",
    );
  });

  it("leaves a note that is already rich text alone", () => {
    const html = "<p>Already <strong>rich</strong></p>";
    expect(noteToHtml(html)).toBe(html);
  });

  it("escapes what would otherwise become markup", () => {
    expect(noteToHtml("5 < 6 & 7 > 6")).toBe("<p>5 &lt; 6 &amp; 7 &gt; 6</p>");
  });

  it("keeps a blank line as a blank paragraph rather than dropping it", () => {
    expect(noteToHtml("a\n\nb")).toBe("<p>a</p><p></p><p>b</p>");
  });

  it("has nothing to say about nothing", () => {
    expect(noteToHtml("")).toBe("");
    expect(noteToHtml(undefined)).toBe("");
  });
});

describe("noteToText", () => {
  it("gives the words back, without the tags", () => {
    expect(noteToText("<p>#George / NP</p><p>Ignition cylinder Change</p>")).toBe(
      "#George / NP\nIgnition cylinder Change",
    );
  });

  it("unescapes what the editor escaped", () => {
    expect(noteToText("<p>5 &lt; 6 &amp; 7</p>")).toBe("5 < 6 & 7");
  });

  it("turns a line break into a line break", () => {
    expect(noteToText("<p>a<br>b</p>")).toBe("a\nb");
  });

  it("leaves a plain-text note exactly as it is", () => {
    expect(noteToText("#George / NP\nIgnition")).toBe("#George / NP\nIgnition");
  });

  it("does not leave a list looking like one long word", () => {
    expect(noteToText("<ul><li>one</li><li>two</li></ul>")).toBe("one\ntwo");
  });

  it("has nothing to say about nothing", () => {
    expect(noteToText("")).toBe("");
    expect(noteToText(undefined)).toBe("");
  });
});

describe("isHtmlNote", () => {
  it("knows rich text when it sees it", () => {
    expect(isHtmlNote("<p>hi</p>")).toBe(true);
  });

  it("does not mistake a plain note that mentions a tag", () => {
    // Real notes contain things like "2004 ford F 150 <needs key>".
    expect(isHtmlNote("2004 ford F 150 <needs key>")).toBe(false);
  });

  it("treats plain text as plain text", () => {
    expect(isHtmlNote("#George / NP")).toBe(false);
    expect(isHtmlNote("")).toBe(false);
  });
});
