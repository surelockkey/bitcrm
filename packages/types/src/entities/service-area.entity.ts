import { type ServiceAreaType } from '../enums/service-area-type.enum';

/** A single geographic point (WGS84). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** One ZIP code, optionally buffered by `+radiusMiles`. */
export interface ZipEntry {
  zip: string;
  /** Extra miles around the ZIP centroid. Omitted → a service default. */
  radiusMiles?: number;
}

/**
 * The raw geometry as the dispatcher entered it, kept for edit/display.
 * Discriminated by the owning ServiceArea's `type`.
 */
export type ServiceAreaDefinition =
  | { type: ServiceAreaType.ZIPS; zips: ZipEntry[] }
  | { type: ServiceAreaType.POLYGON; vertices: GeoPoint[] };

/**
 * Normalized geometry derived from `definition`, used by every match/overlap
 * check so the two input types share one code path.
 * - `circle`  — from a ZIP centroid + radius.
 * - `polygon` — from map dots.
 */
export type CoverageShape =
  | { kind: 'circle'; lat: number; lng: number; radiusMiles: number }
  | { kind: 'polygon'; vertices: GeoPoint[] };

/**
 * A dispatch service area owned by the deal domain. Deals auto-resolve exactly
 * one of these from the client address; technicians are assigned to them.
 * Areas may not geographically overlap (enforced on write).
 */
export interface ServiceArea {
  id: string;
  name: string;
  /** Higher wins when tie-breaking is ever needed; also the list sort key. */
  priority: number;
  active: boolean;
  type: ServiceAreaType;
  definition: ServiceAreaDefinition;
  /** Derived from `definition` at write time; drives resolve/overlap/match. */
  coverage: CoverageShape[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
