# BitCRM Backend — What's Implemented

**Date:** 2026-05-25
**Prepared for:** Product team

The BitCRM backend is a custom platform (replacing Workiz) built as **four independent services**, each owning one area of the business: **Users**, **CRM (clients)**, **Deals (jobs)**, and **Inventory**. Below is a description of what each one actually does today.

---

## User Service — accounts, roles, and permissions

This service is the security backbone of the whole platform. It controls who can log in and what every person is allowed to see and do.

**Login & accounts**
- Email + password login backed by AWS Cognito, with token refresh and a forced "set your own password" flow for newly invited users.
- Admins create a user by entering email, name, role, and department — the account is created in both the login system and our database in one step, and is automatically rolled back if either half fails.
- Users can be **deactivated and later reactivated** — they instantly lose access, but all their history (deals, assignments, timeline entries) stays intact. Nothing is ever hard-deleted.
- A user can fetch their own profile ("me") to drive what the app shows them.

**Roles (the 5 access levels)**
- Ships with five built-in roles — **Super Admin, Admin, Dispatcher, Technician, Read Only** — each with a sensible default set of permissions. Super Admin is protected and can't be tampered with.
- Admins can also create **custom roles** from scratch using a permission matrix.
- Roles are **ranked by priority**, and the system enforces that you can only manage people/roles below your own level — a Dispatcher can't modify an Admin.

**Permissions — the fine-grained part**
- Every action in the platform (view/create/edit/delete, per resource like deals, contacts, products) is gated by permissions defined on the role.
- Roles also carry a **data scope** — *everything*, *just my department*, or *only what's assigned to me* — which is what makes "a technician sees only their own jobs" work everywhere.
- Roles define **which deal stages each role may move a job into** (e.g. a technician can advance their own job but can't mark it Completed or Canceled).
- **Per-user overrides:** an individual can be granted or denied a specific permission on top of their role, without inventing a whole new role for one person.
- Resolved permissions are **cached** so the other services can check "can this person do this?" instantly on every request, and the cache is refreshed automatically when a role changes.

---

## CRM Service — clients (contacts & companies)

This is the client database. Two linked record types: **Contacts** (people) and **Companies**.

**Contacts**
- Store name, **multiple phone numbers**, multiple emails, client type (residential / commercial / other), title, source, and notes.
- **Phone numbers are the primary identifier.** Every phone is normalized to a standard international format on the way in, so search and duplicate-checking are reliable regardless of how the number was typed.
- **Search by phone** returns the matching client (used by telephony/deal flows to recognize a caller).
- **Duplicate prevention:** creating a contact with an already-known phone is blocked.
- **Find-or-create:** when a deal is booked for a phone number we've never seen, the contact is created automatically and linked — no separate "go make the client first" step.
- Contacts are **soft-deleted** (archived), never destroyed.

**Companies**
- Store company name, industry, address, phone, email, website.
- One company can have **many linked contacts** (e.g. several employees of a commercial client), and you can pull the full list of contacts for a company.

---

## Deal Service — the job pipeline

A "deal" is one service job (a lockout, rekey, installation, etc.). This is the heart of daily operations and the most feature-rich service.

**Creating and managing a job**
- Creating a deal **validates the client exists** (checking with the CRM service), **auto-assigns a job number**, sets the booking dispatcher, and starts the job at "New Lead".
- A deal carries the client, company, client type, scheduled date/time slot, service area, job address (with map coordinates), job type, priority (normal / high / urgent), source, tags, and notes.
- Listing deals **automatically respects each user's data scope** — technicians see only their own jobs, department managers see their department, dispatchers/admins see everything — without the caller having to ask for the right filter.

**The pipeline & stage rules**
- Jobs move through a full set of stages grouped into **Submitted → In Progress → Pending → Closed** (New Lead, Estimate Sent, Approved, Assigned, En Route, On Site, Work In Progress, Pending Payment, Pending Parts, Follow Up, On Hold, Canceled).
- **Every stage change is checked against the mover's role** — the system can also tell the app "which stages is this person allowed to move this job to next," so the UI only offers valid options.

**Activity timeline (audit trail)**
- Every meaningful change — created, stage changed, technician assigned/unassigned, product added/removed, note added, payment received — is **automatically recorded with who did it and when.** The timeline is append-only; it can't be edited or deleted.
- Dispatchers and managers can add manual notes to the timeline.

**Technician assignment**
- For a given job, the service produces a list of **qualified technicians** (matched by the job's skill and service area) and **ranks them by distance** to the job address.
- **One-click assign** attaches the technician and, if the job was still in a "Submitted" stage, **automatically advances it to "Assigned."** Unassigning is also supported.
- *Note:* the assignment engine is fully built, but it depends on technician profile data (skills, service areas, home location) that isn't captured yet — so today the candidate list comes back empty until that profile data exists.

**Products on a job**
- A technician can add products to a job; doing so **automatically deducts that stock from the technician's van** (via the Inventory service) and logs it on the timeline. Removing a product **restores the stock.**
- Each line item tracks the **three price tiers** (company cost, tech cost, client price).

**Behind the scenes**
- Listens for **payment events** and updates the job's payment status accordingly, and exposes internal lookups (e.g. "all deals for this technician") used by other parts of the system.

---

## Inventory Service — products, warehouses, and technician vans

Manages everything physical: the catalog, where stock lives, and how it moves.

**Product catalog**
- Full CRUD on products with a unique **SKU and barcode**, hierarchical **categories**, a type (part / tool / material), supplier, minimum stock level, and an optional **serial-tracking** flag.
- **Three-tier pricing** on every item: company cost, tech cost, and client price.
- **Bulk CSV import** for loading or updating the catalog in one go, with per-row error reporting.
- **Product photos** stored in cloud storage via secure, time-limited upload/download links.

**Warehouses**
- Physical storage locations with their own details and **per-product stock levels.**
- Stock can be **received** into a warehouse (e.g. a supplier shipment arrives).

**Technician containers (the "van")**
- Each technician gets a **virtual container representing their van**, which is **created automatically** the first time it's needed — the service listens for "technician activated" events from the User service and provisions the container for them.
- A technician can view **their own** container's contents; managers can view across containers (again respecting data scope).

**Stock movement**
- **Transfers** move stock warehouse-to-container, container-to-warehouse, or container-to-container, and every movement is recorded.
- Dedicated internal operations let the Deal service **deduct and restore** stock as products are added to or removed from jobs, keeping van inventory accurate in real time.

---

## How the services work together

- **Shared login & permissions:** all four services trust the same Cognito login and check the same permission rules, so access control is consistent everywhere.
- **Events:** services announce things that happen (a user is activated, a contact is created, a payment lands) and other services react automatically — e.g. activating a technician triggers their van container to be created.
- **Secure internal calls:** when one service needs another directly (deal → CRM to confirm a client, deal → inventory to move stock), those calls use a private internal channel separate from the public API.
- Every record uses **soft-delete** and carries created/updated timestamps, so history and audit trails are preserved.

---

## Not yet built (rest of scope)

The four services above cover the operational core. Still ahead, at the platform level:

- **Technician profiles** — skills, service areas, home location, and commission settings (this is what will switch on the already-built assignment engine), plus the manager skill-approval workflow.
- **Client duplicate merge** — reviewing and merging flagged duplicate contacts.
- **Telephony** — inbound/outbound calls, recording, IVR routing, caller pop-up.
- **Payments & invoicing** — Stripe, card/ACH/cash, service fees, refunds and disputes.
- **Scheduling** — calendar per technician, time-slot/conflict handling.
- **Platinum / premium client flows** and **work orders**.
- **Reporting & analytics** — revenue, technician performance, and the commission report.
- **Internal messaging**, **admin tools** (audit log, custom fields), and **Workiz data migration**.
- **Front end** — there is no web console or mobile app yet; this is backend (APIs) only.

---

## Engineering quality (brief)

- **Testing:** the platform is thoroughly covered by automated tests (unit, database-integration, and full end-to-end), written test-first — there's roughly as much test code as application code, including the tricky permission and pipeline rules.
- **Infrastructure:** the entire AWS environment is defined as code (Terraform) — containerized services behind a secure load balancer, managed database with continuous backups, cache, and file storage, deployed automatically via a hands-off pipeline with safe auto-rollback.
- **Monitoring:** a full observability stack is in place — dashboards, alerting on failures/latency/outages, centralized logs, and request tracing across services — so issues are caught and diagnosed quickly.

---

*Confidential — BitCRM Backend Review.*
