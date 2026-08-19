import { type TechnicianEligibility } from '../technician-eligibility/technician-eligibility.types';

/** Live Connecticut service-area id (catalog). */
export const CT_SERVICE_AREA_ID = '22abfc3b-3ed7-4aab-89a5-774b83364464';

/** Live catalog job-type ids. */
export const JOB_TYPE_IDS = {
  garageDoor: '74bf7d1a-b123-4a2c-a0f6-5a40144761b6',
  lockout: 'e3d94af3-150b-4990-9f64-1efa091c04f2',
  rekey: 'dff8414d-ab79-4b57-b8e9-18e6e0f9f8fe',
} as const;

const ALL = [JOB_TYPE_IDS.garageDoor, JOB_TYPE_IDS.lockout, JOB_TYPE_IDS.rekey];

/**
 * Ten disposable technicians for testing job assignment in Connecticut, spread
 * across the job types so a dispatcher can see who's eligible for a Lockout vs
 * a Garage Door vs a Rekey. They are eligibility rows only (what the assignment
 * dialog reads) — not login users — with deterministic ids so re-seeding
 * overwrites rather than duplicates. Home coordinates sit around the state so
 * distance ranking is exercised.
 */
export const TEST_TECHNICIANS: {
  n: number;
  firstName: string;
  lastName: string;
  jobTypeIds: string[];
  lat: number;
  lng: number;
}[] = [
  { n: 1, firstName: 'Alex', lastName: 'Rivera', jobTypeIds: ALL, lat: 41.7658, lng: -72.6734 }, // Hartford
  { n: 2, firstName: 'Bella', lastName: 'Cohen', jobTypeIds: ALL, lat: 41.3083, lng: -72.9279 }, // New Haven
  { n: 3, firstName: 'Carlos', lastName: 'Diaz', jobTypeIds: [JOB_TYPE_IDS.lockout, JOB_TYPE_IDS.rekey], lat: 41.0534, lng: -73.5387 }, // Stamford
  { n: 4, firstName: 'Dana', lastName: 'Frost', jobTypeIds: [JOB_TYPE_IDS.lockout, JOB_TYPE_IDS.rekey], lat: 41.1865, lng: -73.1952 }, // Bridgeport
  { n: 5, firstName: 'Ethan', lastName: 'Green', jobTypeIds: [JOB_TYPE_IDS.garageDoor], lat: 41.5582, lng: -73.0515 }, // Waterbury
  { n: 6, firstName: 'Farah', lastName: 'Hill', jobTypeIds: [JOB_TYPE_IDS.garageDoor], lat: 41.5623, lng: -72.6506 }, // Meriden
  { n: 7, firstName: 'Gina', lastName: 'Ross', jobTypeIds: [JOB_TYPE_IDS.lockout], lat: 41.5801, lng: -73.4106 }, // Danbury
  { n: 8, firstName: 'Hugo', lastName: 'Stein', jobTypeIds: [JOB_TYPE_IDS.rekey], lat: 41.3557, lng: -72.0995 }, // New London
  { n: 9, firstName: 'Ivan', lastName: 'Petrov', jobTypeIds: ALL, lat: 41.7627, lng: -72.6743 }, // Hartford
  { n: 10, firstName: 'Jade', lastName: 'Kim', jobTypeIds: [JOB_TYPE_IDS.garageDoor, JOB_TYPE_IDS.lockout], lat: 41.6612, lng: -72.7795 }, // Newington
];

/** Full eligibility rows to upsert. Deterministic ids → idempotent reruns. */
export function planTestTechnicians(now = '2026-08-19T00:00:00.000Z'): TechnicianEligibility[] {
  return TEST_TECHNICIANS.map((t) => ({
    technicianId: `test-tech-ct-${t.n}`,
    jobTypeIds: t.jobTypeIds,
    serviceAreaIds: [CT_SERVICE_AREA_ID],
    assignable: true,
    firstName: t.firstName,
    lastName: t.lastName,
    department: 'CT',
    homeAddress: { lat: t.lat, lng: t.lng },
    updatedAt: now,
  }));
}
