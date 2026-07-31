import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

// The hook is born in the GREEN phase; until then this import keeps the whole
// file red (module not found) — the standard new-module RED failure.
import { useUnsavedChanges } from "./use-unsaved-changes";

/**
 * Minimal consumer: the guard plus one link of every flavor the click
 * interceptor must distinguish. jsdom's test URL is same-origin for
 * root-relative hrefs, so only "Jobs" is intercept-worthy.
 */
function Harness({ dirty }: { dirty: boolean }) {
  const { confirm } = useUnsavedChanges(dirty);
  return (
    <div>
      {/* Raw anchors on purpose: the guard's document-level capture must work
          on any <a>, which is exactly what next/link renders to. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/deals">Jobs</a>
      <a href="#details">Same-page hash</a>
      <a href="https://example.com/pricing">External</a>
      <a href="/reports" target="_blank" rel="noreferrer">
        New tab
      </a>
      <a href="/export.csv" download>
        Download
      </a>
      {confirm}
    </div>
  );
}

const DIALOG_TITLE = "Leave without saving?";

function fireBeforeUnload(): Event {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  mocks.push.mockClear();
});

describe("useUnsavedChanges", () => {
  it("prevents beforeunload while dirty and releases once clean", () => {
    const { rerender } = render(<Harness dirty />);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);

    rerender(<Harness dirty={false} />);
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("removes its listeners on unmount", () => {
    const { unmount } = render(<Harness dirty />);
    unmount();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("intercepts a plain same-origin link click and opens the leave dialog", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Harness dirty />);

    await u.click(screen.getByText("Jobs"));

    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();
    expect(
      screen.getByText("You have unsaved changes. Are you sure you want to leave without saving?"),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("Stay closes without navigating; Leave pushes the remembered href", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Harness dirty />);

    await u.click(screen.getByText("Jobs"));
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(mocks.push).not.toHaveBeenCalled();

    await u.click(screen.getByText("Jobs"));
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Leave" }));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/deals");
  });

  it("ignores modified clicks, hash-only changes, new-tab/download and cross-origin links", async () => {
    render(<Harness dirty />);
    const jobs = screen.getByText("Jobs");

    fireEvent.click(jobs, { ctrlKey: true });
    fireEvent.click(jobs, { metaKey: true });
    fireEvent.click(jobs, { shiftKey: true });
    fireEvent.click(jobs, { altKey: true });
    fireEvent.click(jobs, { button: 1 });
    fireEvent.click(screen.getByText("Same-page hash"));
    fireEvent.click(screen.getByText("External"));
    fireEvent.click(screen.getByText("New tab"));
    fireEvent.click(screen.getByText("Download"));
    expect(screen.queryByText(DIALOG_TITLE)).toBeNull();

    // Positive control: the very same link IS intercepted on a plain left click.
    fireEvent.click(jobs);
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();
  });

  it("leaves link clicks alone while clean", async () => {
    const { rerender } = render(<Harness dirty={false} />);

    fireEvent.click(screen.getByText("Jobs"));
    expect(screen.queryByText(DIALOG_TITLE)).toBeNull();

    // Positive control: the guard kicks in as soon as the page turns dirty.
    rerender(<Harness dirty />);
    fireEvent.click(screen.getByText("Jobs"));
    expect(await screen.findByText(DIALOG_TITLE)).toBeInTheDocument();
  });
});
