import { describe, expect, it } from "vitest";
import { installHintKind, isIosSafari, isStandalone } from "./pwa";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

describe("isIosSafari", () => {
  it("recognises Safari on an iPhone", () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
  });

  it("rejects the iOS browsers that cannot install (Chrome, Firefox, Edge)", () => {
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
  });

  it("rejects Android and desktop", () => {
    expect(isIosSafari(ANDROID_CHROME)).toBe(false);
    expect(isIosSafari(MAC_SAFARI)).toBe(false);
  });
});

describe("installHintKind", () => {
  const base = { standalone: false, dismissed: false, promptAvailable: false, ua: ANDROID_CHROME };

  it("shows the browser's own prompt when one was offered", () => {
    expect(installHintKind({ ...base, promptAvailable: true })).toBe("prompt");
  });

  it("falls back to the Share-sheet recipe on iOS Safari, which has no prompt", () => {
    expect(installHintKind({ ...base, ua: IPHONE_SAFARI })).toBe("ios");
  });

  it("shows nothing where installing isn't possible", () => {
    expect(installHintKind(base)).toBeNull();
    expect(installHintKind({ ...base, ua: MAC_SAFARI })).toBeNull();
    expect(installHintKind({ ...base, ua: IPHONE_CHROME })).toBeNull();
  });

  it("shows nothing once installed or waved away — even with a prompt in hand", () => {
    expect(installHintKind({ ...base, promptAvailable: true, standalone: true })).toBeNull();
    expect(installHintKind({ ...base, promptAvailable: true, dismissed: true })).toBeNull();
  });
});

describe("isStandalone", () => {
  const win = (over: Partial<Window>) => over as unknown as Window;

  it("reads the display-mode media query", () => {
    expect(
      isStandalone(
        win({
          matchMedia: (() => ({ matches: true })) as unknown as Window["matchMedia"],
          navigator: {} as Navigator,
        }),
      ),
    ).toBe(true);
  });

  it("falls back to Safari's own flag", () => {
    expect(
      isStandalone(
        win({
          matchMedia: (() => ({ matches: false })) as unknown as Window["matchMedia"],
          navigator: { standalone: true } as unknown as Navigator,
        }),
      ),
    ).toBe(true);
  });

  it("is false in a plain tab, and survives a browser with neither", () => {
    expect(
      isStandalone(
        win({
          matchMedia: (() => ({ matches: false })) as unknown as Window["matchMedia"],
          navigator: {} as Navigator,
        }),
      ),
    ).toBe(false);
    expect(isStandalone(win({}))).toBe(false);
  });
});
