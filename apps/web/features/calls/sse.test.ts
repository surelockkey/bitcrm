import { describe, it, expect } from "vitest";
import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("emits complete data frames", () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push(d));
    parser.feed('data: {"a":1}\n\n');
    expect(seen).toEqual(['{"a":1}']);
  });

  it("reassembles events split across arbitrary chunk boundaries", () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push(d));
    parser.feed("da");
    parser.feed('ta: {"call":"CA');
    parser.feed('1"}\n');
    expect(seen).toEqual([]); // frame not terminated yet
    parser.feed("\nd");
    parser.feed('ata: {"call":"CA2"}\n\n');
    expect(seen).toEqual(['{"call":"CA1"}', '{"call":"CA2"}']);
  });

  it("ignores heartbeat comments and blank frames", () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push(d));
    parser.feed(": connected\n\n: hb\n\n");
    parser.feed('data: {"ok":true}\n\n: hb\n\n');
    expect(seen).toEqual(['{"ok":true}']);
  });

  it("handles multiple events in one chunk", () => {
    const seen: string[] = [];
    const parser = createSseParser((d) => seen.push(d));
    parser.feed('data: {"n":1}\n\ndata: {"n":2}\n\n');
    expect(seen).toEqual(['{"n":1}', '{"n":2}']);
  });
});
