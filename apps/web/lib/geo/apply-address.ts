import type { Address } from "@bitcrm/types";

type SetField = (path: string, value: unknown) => void;

/**
 * Push a picked place into a react-hook-form address block.
 *
 * `lat`/`lng` are set alongside the text, which is what makes the pick worth
 * anything: the deal is plottable the moment it is saved, instead of depending
 * on a server-side geocode of a hand-typed address that may not resolve.
 */
export function applyAddress(
  setField: SetField,
  address: Address,
  prefix = "address",
): void {
  setField(`${prefix}.street`, address.street);
  setField(`${prefix}.unit`, address.unit ?? "");
  setField(`${prefix}.city`, address.city);
  setField(`${prefix}.state`, address.state);
  setField(`${prefix}.zip`, address.zip);
  setField(`${prefix}.lat`, address.lat);
  setField(`${prefix}.lng`, address.lng);
}
