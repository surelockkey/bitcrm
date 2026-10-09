import { describe, expect, it } from "vitest";
import { templateSnippet, templateText } from "./template-text";

/**
 * Templates come over from Workiz as HTML ("Hi! This is Sure Lock &amp; Key,
 * …&nbsp;Please, …"); the lists and the editor show them as text.
 */
describe("templateText", () => {
  it("turns Workiz's HTML into the text the editor shows — lines kept, entities read", () => {
    expect(templateText("<p>Hi {{first_name}},</p><p>Sure Lock &amp; Key&nbsp;here</p>")).toBe(
      "Hi {{first_name}},\nSure Lock & Key here",
    );
    expect(templateText("Line one<br>Line two<br/>&lt;3 &quot;us&quot; &#39;ok&#39;")).toBe('Line one\nLine two\n<3 "us" \'ok\'');
  });

  it("leaves plain text as it is", () => {
    expect(templateText("Hi {{first_name}}, running late")).toBe("Hi {{first_name}}, running late");
  });
});

describe("templateSnippet", () => {
  it("is one line of text: no tags, no entities, whitespace folded", () => {
    expect(templateSnippet("<p>Hi! This is Sure Lock &amp; Key,</p>\n<p>the&nbsp;locksmith   company.</p>")).toBe(
      "Hi! This is Sure Lock & Key, the locksmith company.",
    );
  });
});
