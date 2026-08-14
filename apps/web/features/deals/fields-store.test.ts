import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_VISIBLE, JOB_FIELDS } from "./fields";
import { useJobFieldsStore } from "./fields-store";

const KEY = "bitcrm.jobs-fields";

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
});

describe("useJobFieldsStore", () => {
  it("shows every field by default", () => {
    expect(useJobFieldsStore.getState().visible).toEqual(DEFAULT_VISIBLE);
  });

  it("toggle hides a field and toggling again shows it back", () => {
    useJobFieldsStore.getState().toggle("tags");
    expect(useJobFieldsStore.getState().visible.tags).toBe(false);
    useJobFieldsStore.getState().toggle("tags");
    expect(useJobFieldsStore.getState().visible.tags).toBe(true);
  });

  it("toggling one field leaves the others alone", () => {
    useJobFieldsStore.getState().toggle("city");
    const { visible } = useJobFieldsStore.getState();
    for (const f of JOB_FIELDS.filter((f) => f.id !== "city")) {
      expect(visible[f.id]).toBe(DEFAULT_VISIBLE[f.id]);
    }
    expect(visible.city).toBe(!DEFAULT_VISIBLE.city);
  });

  it("toggles a custom-field column on and persists it", () => {
    useJobFieldsStore.getState().toggle("cf:cf-gate");
    expect(useJobFieldsStore.getState().visible["cf:cf-gate"]).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!).state.visible["cf:cf-gate"]).toBe(true);
  });

  it("persists the choice so it survives a reload", () => {
    useJobFieldsStore.getState().toggle("tags");
    const stored = localStorage.getItem(KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).state.visible.tags).toBe(false);
  });

  it("rehydrates hidden fields from storage — the reload path", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { visible: { ...DEFAULT_VISIBLE, scheduled: false } }, version: 0 }),
    );
    await useJobFieldsStore.persist.rehydrate();
    expect(useJobFieldsStore.getState().visible.scheduled).toBe(false);
    expect(useJobFieldsStore.getState().visible.client).toBe(true);
  });

  it("sanitizes stale keys and bad values on rehydrate", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { visible: { tags: false, legacyColumn: false, tech: "nope" } },
        version: 0,
      }),
    );
    await useJobFieldsStore.persist.rehydrate();
    const { visible } = useJobFieldsStore.getState();
    expect(visible.tags).toBe(false);
    expect(visible.tech).toBe(true);
    expect("legacyColumn" in visible).toBe(false);
  });

  it("survives unparseable storage by falling back to defaults", async () => {
    localStorage.setItem(KEY, "{not json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await useJobFieldsStore.persist.rehydrate();
      expect(useJobFieldsStore.getState().visible).toEqual(DEFAULT_VISIBLE);
    } finally {
      errSpy.mockRestore();
    }
  });
});
