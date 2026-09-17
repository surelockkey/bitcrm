import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { INSTALL_HINT_DISMISSED_KEY } from "../pwa";
import { InstallHint, resetInstallHintForTests } from "./install-hint";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Mobile Safari/537.36";

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

/** The event Chromium fires; jsdom has no constructor for it. */
function firePrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  window.dispatchEvent(event);
  return event;
}

describe("InstallHint", () => {
  beforeEach(() => {
    resetInstallHintForTests();
    setUserAgent(ANDROID_CHROME);
  });

  it("shows nothing until the browser offers an install", () => {
    render(<InstallHint />);
    expect(screen.queryByTestId("install-hint")).not.toBeInTheDocument();
  });

  it("offers the button once Chromium fires beforeinstallprompt, and installs on tap", async () => {
    render(<InstallHint />);
    const event = firePrompt("accepted");

    const add = await screen.findByTestId("install-hint-add");
    await userEvent.click(add);

    expect(event.prompt).toHaveBeenCalled();
    // Accepted: the hint has done its job and does not come back.
    await vi.waitFor(() => expect(screen.queryByTestId("install-hint")).not.toBeInTheDocument());
    expect(localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBe("1");
  });

  it("gives iOS Safari the Share-sheet recipe instead of a button", () => {
    setUserAgent(IPHONE_SAFARI);
    render(<InstallHint />);

    expect(screen.getByTestId("install-hint")).toBeInTheDocument();
    expect(screen.getByText("Add to Home Screen")).toBeInTheDocument();
    expect(screen.queryByTestId("install-hint-add")).not.toBeInTheDocument();
  });

  it("stays away once dismissed, and remembers that", async () => {
    setUserAgent(IPHONE_SAFARI);
    render(<InstallHint />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByTestId("install-hint")).not.toBeInTheDocument();
    expect(localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBe("1");
  });

  it("does not offer anything to a browser that already runs it installed", () => {
    setUserAgent(IPHONE_SAFARI);
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: true } as unknown as MediaQueryList);

    render(<InstallHint />);

    expect(screen.queryByTestId("install-hint")).not.toBeInTheDocument();
    matchMedia.mockRestore();
  });
});
