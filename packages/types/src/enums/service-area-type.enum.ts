/**
 * How a service area's geography is defined by the dispatcher.
 *
 * - `ZIPS`    — one or more ZIP codes, each optionally buffered by `+N miles`.
 *               A single ZIP + radius is just a one-entry list, so both the
 *               "zip + n miles" and "list of zips" UI modes serialize here.
 * - `POLYGON` — a free-form shape drawn on the map by dropping ordered dots.
 */
export enum ServiceAreaType {
  ZIPS = 'zips',
  POLYGON = 'polygon',
}
