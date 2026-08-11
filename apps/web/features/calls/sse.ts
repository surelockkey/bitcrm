/**
 * Minimal incremental SSE parser for fetch-streamed responses (EventSource
 * can't send an Authorization header, so we read the stream ourselves).
 * Feed it raw text chunks in any split; it emits each complete `data:` frame.
 * Comment lines (`: hb`) are heartbeats and are ignored.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";

  return {
    feed(chunk: string): void {
      buffer += chunk;
      // Frames are separated by a blank line.
      for (;;) {
        const sep = buffer.indexOf("\n\n");
        if (sep === -1) break;
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length) onData(dataLines.join("\n"));
      }
    },
  };
}
