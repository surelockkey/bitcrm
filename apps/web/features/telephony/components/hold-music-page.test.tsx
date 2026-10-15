import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PREMADE_HOLD_SOUNDS } from "@bitcrm/types";

/**
 * Phone → Hold music: what a caller hears while the agent has them on hold.
 * One company-wide choice — a ready-made track or the office's own recording
 * — and each can be listened to before it is chosen.
 */

const mocks = vi.hoisted(() => ({
  config: { data: { technicianLine: null, holdSound: null } as Record<string, unknown> | undefined, isLoading: false },
  save: vi.fn(),
  upload: vi.fn(),
  canEdit: true,
  fetchAudio: vi.fn(async () => new Blob(["x"], { type: "audio/mpeg" })),
}));

vi.mock("../config-hooks", () => ({
  useTelephonyConfig: () => mocks.config,
  useSetHoldSound: () => ({ mutate: mocks.save, isPending: false }),
}));
vi.mock("../call-flows-hooks", () => ({
  useUploadFlowAudio: () => ({ mutate: mocks.upload, isPending: false }),
}));
vi.mock("../call-flows-api", () => ({ fetchFlowAudioBlob: mocks.fetchAudio }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (_r: string, action?: string) => action !== "edit" || mocks.canEdit,
    isLoading: false,
  }),
}));

const { HoldMusicPage } = await import("./hold-music-page");

const AUDIO_ID = "3f1c2a4e-9b7d-4c1e-8a2f-0d6e5b4c3a21";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canEdit = true;
  mocks.config = { data: { technicianLine: null, holdSound: null }, isLoading: false };
  // jsdom has no media playback.
  window.HTMLMediaElement.prototype.play = vi.fn(async () => {});
  window.HTMLMediaElement.prototype.pause = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("HoldMusicPage", () => {
  it("lists every ready-made track, the default chosen when nothing was", () => {
    render(<HoldMusicPage />);
    for (const sound of PREMADE_HOLD_SOUNDS) {
      expect(screen.getByRole("radio", { name: sound.name })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: PREMADE_HOLD_SOUNDS[0].name })).toBeChecked();
  });

  it("shows the track the company chose", () => {
    mocks.config.data = { holdSound: { kind: "premade", id: "guitars" } };
    render(<HoldMusicPage />);
    expect(screen.getByRole("radio", { name: "Guitars" })).toBeChecked();
  });

  it("saves a track when it is picked", () => {
    render(<HoldMusicPage />);
    fireEvent.click(screen.getByRole("radio", { name: "Ambient" }));
    expect(mocks.save).toHaveBeenCalledWith({ kind: "premade", id: "ambient" });
  });

  it("plays a track before it is chosen", async () => {
    render(<HoldMusicPage />);
    fireEvent.click(screen.getByRole("button", { name: "Play Ambient" }));
    await waitFor(() => expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled());
    const audio = document.querySelector("audio")!;
    expect(audio.src).toBe(PREMADE_HOLD_SOUNDS.find((s) => s.id === "ambient")!.url);
    expect(mocks.save).not.toHaveBeenCalled();
    // …and the same button stops it.
    fireEvent.click(await screen.findByRole("button", { name: "Stop Ambient" }));
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("uploads the office's own recording and makes it the hold music", () => {
    mocks.upload.mockImplementation((_file: File, opts: { onSuccess: (a: unknown) => void }) =>
      opts.onSuccess({ id: AUDIO_ID, name: "jingle.mp3" }),
    );
    render(<HoldMusicPage />);
    const file = new File(["ID3"], "jingle.mp3", { type: "audio/mpeg" });
    fireEvent.change(screen.getByLabelText("Upload a recording"), { target: { files: [file] } });

    expect(mocks.upload).toHaveBeenCalledWith(file, expect.anything());
    expect(mocks.save).toHaveBeenCalledWith({ kind: "custom", audioId: AUDIO_ID, name: "jingle.mp3" });
  });

  it("shows the uploaded recording as chosen, and plays it through the signed-in API", async () => {
    mocks.config.data = { holdSound: { kind: "custom", audioId: AUDIO_ID, name: "jingle.mp3" } };
    render(<HoldMusicPage />);
    expect(screen.getByRole("radio", { name: "jingle.mp3" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Play jingle.mp3" }));
    await waitFor(() => expect(mocks.fetchAudio).toHaveBeenCalledWith(AUDIO_ID));
    await waitFor(() => expect(document.querySelector("audio")!.src).toBe("blob:preview"));
  });

  it("lets anyone listen but only settings.edit change it", () => {
    mocks.canEdit = false;
    render(<HoldMusicPage />);
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.queryByLabelText("Upload a recording")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Play ${PREMADE_HOLD_SOUNDS[0].name}` })).toBeEnabled();
  });
});
