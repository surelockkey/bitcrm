import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Address } from "@bitcrm/types";
import { AddressAutocomplete } from "./address-autocomplete";

const mapsKey = vi.hoisted(() => ({ value: "test-key" }));
vi.mock("@/lib/env", () => ({
  env: {
    apiBaseUrl: "http://api.test",
    get googleMapsApiKey() {
      return mapsKey.value;
    },
    googleMapsMapId: "test-map",
  },
}));

const placesLib = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@vis.gl/react-google-maps", () => ({
  useMapsLibrary: () => placesLib.value,
}));

const COMPONENTS = [
  { types: ["street_number"], longText: "123", shortText: "123" },
  { types: ["route"], longText: "Peachtree Street", shortText: "Peachtree St" },
  { types: ["locality"], longText: "Atlanta", shortText: "Atlanta" },
  { types: ["administrative_area_level_1"], longText: "Georgia", shortText: "GA" },
  { types: ["postal_code"], longText: "30303", shortText: "30303" },
];

/** A stand-in for the Places API (New). */
function fakePlaces() {
  const fetchFields = vi.fn().mockResolvedValue(undefined);
  return {
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: {
      fetchAutocompleteSuggestions: vi.fn().mockResolvedValue({
        suggestions: [
          {
            placePrediction: {
              placeId: "place-1",
              text: { toString: () => "123 Peachtree St, Atlanta, GA" },
              toPlace: () => ({
                fetchFields,
                addressComponents: COMPONENTS,
                location: { lat: () => 33.749, lng: () => -84.388 },
              }),
            },
          },
        ],
      }),
    },
  };
}

/** Drives the component the way a form does: it owns the street text. */
function Harness({ onSelect }: { onSelect: (a: Address) => void }) {
  const [street, setStreet] = useState("");
  return (
    <AddressAutocomplete
      value={street}
      onChange={setStreet}
      onSelect={onSelect}
      placeholder="Street"
    />
  );
}

beforeEach(() => {
  mapsKey.value = "test-key";
  placesLib.value = fakePlaces();
});

describe("AddressAutocomplete", () => {
  it("suggests places as the dispatcher types", async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Street"), "123 Peach");

    expect(
      await screen.findByRole("option", { name: /123 Peachtree St, Atlanta, GA/ }),
    ).toBeInTheDocument();
  });

  /**
   * The whole point: a picked place carries coordinates, so the deal lands on the
   * dispatch map immediately instead of waiting on a server-side geocode that
   * might not resolve at all.
   */
  it("yields a full address with coordinates when a place is picked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.type(screen.getByPlaceholderText("Street"), "123 Peach");
    await user.click(await screen.findByRole("option"));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith({
      street: "123 Peachtree St",
      unit: undefined,
      city: "Atlanta",
      state: "GA",
      zip: "30303",
      lat: 33.749,
      lng: -84.388,
    });
  });

  it("does not query on a query too short to be an address", async () => {
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Street"), "12");

    await waitFor(() =>
      expect(
        (placesLib.value as ReturnType<typeof fakePlaces>).AutocompleteSuggestion
          .fetchAutocompleteSuggestions,
      ).not.toHaveBeenCalled(),
    );
  });

  // A dead lookup must not take the form down with it.
  it("still lets the address be typed when the lookup fails", async () => {
    (
      placesLib.value as ReturnType<typeof fakePlaces>
    ).AutocompleteSuggestion.fetchAutocompleteSuggestions.mockRejectedValue(
      new Error("quota exceeded"),
    );
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);

    const input = screen.getByPlaceholderText("Street");
    await user.type(input, "123 Peach");

    expect(input).toHaveValue("123 Peach");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  // Without a key the field must still be a usable text input — the backend
  // geocodes the typed address later.
  it("falls back to a plain text field with no Maps key", async () => {
    mapsKey.value = "";
    const user = userEvent.setup();
    render(<Harness onSelect={vi.fn()} />);

    const input = screen.getByPlaceholderText("Street");
    await user.type(input, "123 Peach");

    expect(input).toHaveValue("123 Peach");
    expect(input).not.toHaveAttribute("role", "combobox");
  });
});
