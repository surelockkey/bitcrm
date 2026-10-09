import type { FakeRoute } from "@/test/page-load";

/** The people and the fake server behind the profile page's tests. */

export const adminMe = {
  id: "u-admin",
  firstName: "Ada",
  lastName: "Admin",
  email: "ada@example.com",
  roleId: "role-admin",
  department: "Office",
  phone: "+14045550100",
  status: "active",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "",
};

export const techMe = {
  ...adminMe,
  id: "u-tech",
  firstName: "Theo",
  lastName: "Tech",
  email: "theo@example.com",
  roleId: "role-technician",
  department: "Field",
  phone: "+14045551234",
};

export const techProfile = {
  userId: "u-tech",
  technicianType: "regular",
  phone: "+14045551234",
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  status: "pending",
  createdAt: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const techOnboarding = {
  status: "pending",
  checklist: { profileComplete: true, assignmentsApproved: false, commissionSet: false },
  completedSteps: 1,
  totalSteps: 3,
};

export const techAssignments = {
  jobTypes: [{ technicianId: "u-tech", jobTypeId: "jt-rekey", status: "approved" }],
  serviceAreas: [{ technicianId: "u-tech", serviceAreaId: "sa-lake", status: "approved" }],
};

/** What the server answers for `who`; a route's beat may be set to reproduce an order. */
export function profileRoutes(who: typeof adminMe, delays: Partial<Record<string, number>> = {}): FakeRoute[] {
  return [
    { match: /\/users\/me$/, method: "GET", reply: () => who, delayMs: delays.me ?? 10 },
    { match: /\/users\/technicians\/u-tech\/profile$/, reply: () => techProfile, delayMs: delays.profile },
    { match: /\/users\/technicians\/u-tech\/assignments$/, reply: () => techAssignments, delayMs: delays.assignments },
    { match: /\/users\/technicians\/u-tech\/onboarding-status$/, reply: () => techOnboarding, delayMs: delays.onboarding },
    {
      match: /\/deals\/job-types$/,
      reply: () => [{ id: "jt-rekey", name: "Rekey Visit", priority: 1, active: true }],
      delayMs: delays.catalogs,
    },
    {
      match: /\/deals\/service-areas$/,
      reply: () => [{ id: "sa-lake", name: "Lakeside", priority: 1, active: true }],
      delayMs: delays.catalogs,
    },
  ];
}
