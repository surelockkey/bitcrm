"use client";

/**
 * Data-bound Workiz selects for the job forms (New Job and the job page's
 * Details tab): the kit's `WzSelect` / `WzMultiSelect` / `WzTextField` wired
 * to our catalogs and hooks. Each one reads the very hooks the old Radix
 * selects read (same query keys, so the pages' loaders still prefetch them)
 * and emits plain ids, so they drop into a react-hook-form `Controller` or a
 * draft setter alike.
 */

import { useState, type ReactNode, type Ref } from "react";
import { WzButton, WzMultiSelect, WzNotice, WzSelect, WzTextField, type WzOption } from "@/components/workiz";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useActiveBusinessProfiles } from "@/features/business-profiles/hooks";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { useActiveJobSources } from "@/features/job-sources/active-hooks";
import { useCreateJobSource, useJobSource } from "@/features/job-sources/hooks";
import { activeJobSources } from "@/features/job-sources/lib";
import { useActiveJobTypes } from "@/features/job-types/active-hooks";
import { useCreateJobType, useJobType } from "@/features/job-types/hooks";
import { activeJobTypes } from "@/features/job-types/lib";
import { useEffectiveServiceArea, useServiceAreas } from "@/features/service-areas/hooks";
import { useSuggestedTechs, useUserMap } from "../../hooks";
import { personName } from "../../person-name";
import {
  businessProfileOptions,
  catalogOptions,
  countryOf,
  countryOptions,
  externalCompanyOptions,
  serviceAreaOptions,
  serviceAreaValueLabel,
  stateCode,
  stateOptions,
  teamNotice,
  teamOptions,
} from "./options";

/** What every bound select takes besides its data. */
export interface WzBoundSelectProps {
  /** The chosen id; "" / null / undefined for none. */
  value: string | null | undefined;
  /** The new id, "" when cleared. */
  onChange: (id: string) => void;
  onBlur?: () => void;
  /** Workiz's words by default ("Job type", "Job source", …). */
  label?: string;
  /** 4px corners on New Job cards; square on the job page. */
  shape?: "rounded" | "square";
  disabled?: boolean;
  /** "Required field" under the box. */
  error?: string;
  className?: string;
  id?: string;
  name?: string;
  ref?: Ref<HTMLInputElement>;
}

function passThrough(p: WzBoundSelectProps) {
  return {
    onBlur: p.onBlur,
    shape: p.shape,
    disabled: p.disabled,
    error: p.error,
    className: p.className,
    id: p.id,
    name: p.name,
    ref: p.ref,
  };
}

/* ------------------------------------------------------ "+ Add new" dialog */

/**
 * Workiz's "+ Add new" row, for someone allowed to grow the catalog: the text
 * typed into the select becomes the new entry straight away; with nothing
 * typed, a small dialog asks for the name first.
 */
function useAddNew(
  noun: string,
  create: (name: string, done: (id: string) => void) => void,
  onCreated: (id: string) => void,
) {
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const submit = (text: string) => {
    const n = text.trim();
    if (!n) return;
    setAsking(false);
    create(n, onCreated);
  };
  const dialog = (
    <Dialog open={asking} onOpenChange={setAsking}>
      <DialogContent className="max-w-sm">
        <DialogTitle>{`Add ${noun}`}</DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            submit(name);
          }}
        >
          <WzTextField label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} overhang={false} />
          <div className="flex justify-end gap-2">
            <WzButton variant="secondary" size="regular" onClick={() => setAsking(false)}>
              Cancel
            </WzButton>
            <WzButton type="submit" size="regular" disabled={!name.trim()}>
              Add
            </WzButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
  const onCreate = (text: string) => {
    if (text.trim()) submit(text);
    else {
      setName("");
      setAsking(true);
    }
  };
  return { onCreate, dialog };
}

/* ---------------------------------------------------------------- job type */

/**
 * "Job type" (new_02_job_type_open): the active catalog in picker order; an
 * archived type the job still has keeps its name. `canCreate` adds Workiz's
 * "+ Add new" first row (pass `can("job_types", "create")`).
 */
export function WzJobTypeSelect({ canCreate = false, ...p }: WzBoundSelectProps & { canCreate?: boolean }) {
  const { data } = useActiveJobTypes();
  const active = activeJobTypes(data);
  const needsArchived = Boolean(p.value) && !active.some((t) => t.id === p.value);
  const { data: archived } = useJobType(p.value ?? "", needsArchived);
  const create = useCreateJobType();
  const add = useAddNew(
    "job type",
    (name, done) =>
      create.mutate({ name, priority: 0, active: true }, { onSuccess: (t: { id: string }) => done(t.id) }),
    p.onChange,
  );
  return (
    <>
      <WzSelect
        {...passThrough(p)}
        label={p.label ?? "Job type"}
        options={catalogOptions(active, needsArchived ? archived : null)}
        value={p.value ?? ""}
        onChange={p.onChange}
        createOption={canCreate ? { onCreate: add.onCreate } : undefined}
      />
      {canCreate ? add.dialog : null}
    </>
  );
}

/* -------------------------------------------------------------- job source */

/**
 * "Job source" (new_03_job_source_open): clearable (Workiz's × once chosen);
 * an archived source keeps its name; `canCreate` adds "+ Add new"
 * (`can("job_sources", "create")`).
 */
export function WzJobSourceSelect({ canCreate = false, ...p }: WzBoundSelectProps & { canCreate?: boolean }) {
  const { data } = useActiveJobSources();
  const active = activeJobSources(data);
  const needsArchived = Boolean(p.value) && !active.some((t) => t.id === p.value);
  const { data: archived } = useJobSource(p.value ?? "", needsArchived);
  const create = useCreateJobSource();
  const add = useAddNew(
    "job source",
    (name, done) =>
      create.mutate({ name, priority: 0, active: true }, { onSuccess: (s: { id: string }) => done(s.id) }),
    p.onChange,
  );
  return (
    <>
      <WzSelect
        {...passThrough(p)}
        label={p.label ?? "Job source"}
        options={catalogOptions(active, needsArchived ? archived : null)}
        value={p.value ?? ""}
        onChange={p.onChange}
        clearable
        createOption={canCreate ? { onCreate: add.onCreate } : undefined}
      />
      {canCreate ? add.dialog : null}
    </>
  );
}

/* -------------------------------------------------------- external company */

/** "External company": enabled partners; a disabled one the job names stays. Clearable. */
export function WzExternalCompanySelect(p: WzBoundSelectProps) {
  const { data } = useExternalCompanies();
  return (
    <WzSelect
      {...passThrough(p)}
      label={p.label ?? "External company"}
      options={externalCompanyOptions(data, p.value ?? undefined)}
      value={p.value ?? ""}
      onChange={p.onChange}
      clearable
    />
  );
}

/* ------------------------------------------------------- business profile */

/**
 * Our "Company" — the business profile a job is issued under. Workiz has no
 * such field (it switches company at the top of the app); we keep it as a
 * Workiz select. Archived selections stay readable.
 */
export function WzBusinessProfileSelect({
  showDefaultHint = false,
  fallbackName,
  clearable = false,
  ...p
}: WzBoundSelectProps & { showDefaultHint?: boolean; fallbackName?: string; clearable?: boolean }) {
  const { data, active, isLoading } = useActiveBusinessProfiles();
  return (
    <WzSelect
      {...passThrough(p)}
      label={p.label ?? "Company"}
      options={businessProfileOptions({ data, active, value: p.value, showDefaultHint, fallbackName, loading: isLoading })}
      value={p.value ?? ""}
      onChange={p.onChange}
      clearable={clearable}
    />
  );
}

/* ------------------------------------------------------------ service area */

/**
 * "Service area", auto-detected from the address as before (manual pick >
 * the area containing the address > the nearest one) and written Workiz's
 * way: "SURE LOCK DALLAS TX (0 miles away)". `value` is the hand-picked id
 * (undefined = auto); a pick emits its id.
 */
export function WzServiceAreaSelect({
  lat,
  lng,
  ...p
}: Omit<WzBoundSelectProps, "value"> & { value: string | undefined; lat?: number; lng?: number }) {
  const { data: areas } = useServiceAreas();
  const effective = useEffectiveServiceArea(lat, lng, p.value || undefined);
  const shown = p.value || effective.area?.id || "";
  const label = serviceAreaValueLabel(effective);
  const options = serviceAreaOptions(areas, p.value || undefined).map((o) =>
    o.value === effective.area?.id && label ? { ...o, label } : o,
  );
  return (
    <WzSelect
      {...passThrough(p as WzBoundSelectProps)}
      label={p.label ?? "Service area"}
      options={options}
      value={shown}
      valueLabel={label ?? effective.area?.name}
      onChange={p.onChange}
    />
  );
}

/* ---------------------------------------------------------- state, country */

/**
 * "State": Workiz's full-name list for the United States (and Canada's
 * provinces when Country is Canada), stored as the code Google gives ("TX");
 * a state written out ("Texas") reads as its code. Any other country gets a
 * plain box, as its regions are not a list we keep.
 */
export function WzStateSelect({
  country,
  ref,
  ...p
}: WzBoundSelectProps & { country?: string }) {
  const options = stateOptions(country);
  if (!options.length) {
    return (
      <WzTextField
        label={p.label ?? "State"}
        value={p.value ?? ""}
        onChange={(e) => p.onChange(e.target.value)}
        onBlur={p.onBlur}
        disabled={p.disabled}
        error={p.error}
        className={p.className}
        id={p.id}
        name={p.name}
        ref={ref}
        overhang={false}
      />
    );
  }
  const code = stateCode(p.value ?? "", country);
  return (
    <WzSelect
      {...passThrough(p)}
      ref={ref}
      label={p.label ?? "State"}
      options={options}
      value={code}
      valueLabel={p.value ?? undefined}
      onChange={p.onChange}
    />
  );
}

/** "Country": Workiz's 249, United States when the address names none; ISO codes out. */
export function WzCountrySelect(p: WzBoundSelectProps) {
  return (
    <WzSelect
      {...passThrough(p)}
      label={p.label ?? "Country"}
      options={COUNTRY_OPTIONS}
      value={countryOf({ country: p.value ?? undefined })}
      onChange={p.onChange}
    />
  );
}

const COUNTRY_OPTIONS: WzOption[] = countryOptions();

/* -------------------------------------------------------------------- team */

export interface WzTeamSelectProps {
  jobTypeId: string;
  address: { lat?: number; lng?: number };
  /** A hand-picked service area, if any — the notice names the job's area. */
  serviceAreaId?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /**
   * "multi" (New Job "Assign team members", new_06_team_open): picks become
   * chips. "add" (the job page's "Assign A Tech"): a pick is added to the team
   * the page lists above, and the box empties again.
   */
  variant?: "multi" | "add";
  label?: string;
  shape?: "rounded" | "square";
  disabled?: boolean;
  /** Leave the notice line out. */
  hideNotice?: boolean;
  /** Right of the notice: New Job's "View schedule" pill. */
  aside?: ReactNode;
  className?: string;
}

/**
 * The team picker with our eligibility rules (techs approved for the job type
 * and the area are pickable; the rest are listed, disabled, with why) and
 * Workiz's notice under it: "Please select a service area to display
 * available techs", then "2 techs work in SURE LOCK DALLAS TX and can perform
 * any job type". Asks the same question as the page loaders
 * (`useSuggestedTechs({ jobTypeId, lat, lng })`), so the answer is cached.
 */
export function WzTeamSelect({
  jobTypeId,
  address,
  serviceAreaId,
  value,
  onChange,
  variant = "multi",
  label,
  shape,
  disabled,
  hideNotice = false,
  aside,
  className,
}: WzTeamSelectProps) {
  const hasAddress = address.lat !== undefined && address.lng !== undefined;
  const effective = useEffectiveServiceArea(address.lat, address.lng, serviceAreaId || undefined);
  const query = useSuggestedTechs(
    { jobTypeId: jobTypeId || undefined, lat: address.lat, lng: address.lng },
    hasAddress,
  );
  const techs = query.data ?? [];
  const { map: directory } = useUserMap(value);
  const options = teamOptions(techs, value, (id) => personName(directory.get(id)));
  const { data: types } = useActiveJobTypes();
  const jobTypeName = jobTypeId ? (types ?? []).find((t) => t.id === jobTypeId)?.name : undefined;
  const area = effective.area;
  const notice = teamNotice({
    hasArea: hasAddress && !!area,
    areaName: area?.name,
    count: techs.filter((t) => t.eligible).length,
    jobTypeName,
  });

  const select =
    variant === "multi" ? (
      <WzMultiSelect
        label={label ?? "Assign team members"}
        options={options}
        value={value}
        onChange={onChange}
        shape={shape}
        disabled={disabled}
        loading={query.isLoading}
      />
    ) : (
      <WzSelect
        label={label ?? "Assign A Tech"}
        geometry="plain"
        options={options.filter((o) => !value.includes(o.value))}
        value=""
        onChange={(id) => (id ? onChange([...value, id]) : undefined)}
        shape={shape}
        disabled={disabled}
        loading={query.isLoading}
      />
    );

  const showNotice = !hideNotice && !(notice.kind === "count" && query.isLoading);
  return (
    <div className={cn("flex flex-col", className)}>
      {select}
      {showNotice || aside ? (
        <div className="flex items-start justify-between gap-2.5">
          {showNotice ? <TeamNoticeLine notice={notice} /> : <span />}
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Workiz's two notices: the red "Please select a service area…" 15px under
 * the select (`.teamAssignment-module__notValid`), or the count line in ink
 * with its figures bold (new_12_client_picked_scroll0).
 */
function TeamNoticeLine({ notice }: { notice: ReturnType<typeof teamNotice> }) {
  if (notice.kind === "no-area") {
    return (
      <WzNotice data-testid="wz-team-notice" className="mt-[15px]">
        Please select a service area to display available techs
      </WzNotice>
    );
  }
  const one = notice.count === 1;
  return (
    <p data-testid="wz-team-notice" className="mt-[13px] text-[14px] leading-4 font-normal text-wz-strong">
      <b className="font-bold">{notice.count}</b> {one ? "tech works" : "techs work"} in{" "}
      <b className="font-bold">{notice.area}</b> and can perform{" "}
      <b className="font-bold">{notice.jobType ?? "any job type"}</b>
    </p>
  );
}
