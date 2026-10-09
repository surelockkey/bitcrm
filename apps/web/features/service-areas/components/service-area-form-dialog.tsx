"use client";

import { useMemo, useState } from "react";
import { ServiceAreaType, type ServiceArea, type GeoPoint } from "@bitcrm/types";
import { WzColorDots } from "@/components/workiz/color-dots";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSelect } from "@/components/workiz/select";
import { WzTextField } from "@/components/workiz/text-field";
import { DEFAULT_TZ, US_TIMEZONES } from "@/lib/timezone";
import { useCreateServiceArea, useUpdateServiceArea } from "../hooks";
import { serviceAreaFormSchema, toServiceAreaBody } from "../schemas";
import { WZ_AREA_COLORS } from "../lib";
import { useNumbers } from "@/features/telephony/numbers-hooks";
import { formatPhone } from "@/lib/phone";
import { BusinessProfileSelect } from "@/features/business-profiles/components/business-profile-select";
import { ZipListEditor, type ZipRow } from "./zip-list-editor";
import { PolygonMapEditor } from "./polygon-map-editor";

function initialZips(area?: ServiceArea): ZipRow[] {
  if (area?.definition.type === ServiceAreaType.ZIPS) {
    return area.definition.zips.map((z) => ({ zip: z.zip, radiusMiles: z.radiusMiles ?? "" }));
  }
  return [{ zip: "", radiusMiles: "" }];
}

function initialVertices(area?: ServiceArea): GeoPoint[] {
  return area?.definition.type === ServiceAreaType.POLYGON ? area.definition.vertices : [];
}

/** A bold form label over a control, as Workiz's "Default Tax" / "Advanced area select" (14px/700 #404040). */
function SectionLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm leading-4 font-bold text-wz-strong">
      {children}
    </label>
  );
}

/** A small grey line under a control (Workiz's `small` hint). */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-[13px] text-wz-caption">{children}</p>;
}

/**
 * Workiz's "Add New Service area" (pg_settings_catalogs_wz_metroareas_add_open):
 * the whole window, fields down the left 755px — Name, our Priority, then
 * Workiz's "Choose Color" squares, "Default Tax" (ours: the area's own sales
 * tax and its company), and "Advanced area select", the ON/OFF switch that
 * turns the ZIP-and-radius area into a polygon drawn on the map — with
 * Cancel / Save on the white footer. Timezone and the client-facing number
 * are ours, in Workiz's floating-label selects. On / off is the grid's
 * Status switch; an edit keeps the state.
 */
export function ServiceAreaFormDialog({
  area,
  open,
  onOpenChange,
}: {
  area?: ServiceArea;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(area);
  const create = useCreateServiceArea();
  const update = useUpdateServiceArea(area?.id ?? "");
  const pending = create.isPending || update.isPending;
  // Only fetched while the dialog is open.
  const { data: numbers } = useNumbers(open);

  const [name, setName] = useState(area?.name ?? "");
  const [priority, setPriority] = useState(String(area?.priority ?? 0));
  const active = area?.active ?? true;
  const [timezone, setTimezone] = useState(area?.timezone ?? DEFAULT_TZ);
  const [type, setType] = useState<ServiceAreaType>(area?.type ?? ServiceAreaType.ZIPS);
  const [zips, setZips] = useState<ZipRow[]>(initialZips(area));
  const [vertices, setVertices] = useState<GeoPoint[]>(initialVertices(area));
  const [callerId, setCallerId] = useState(area?.callerId ?? "");
  const [color, setColor] = useState(area?.color ?? "");
  const [taxEnabled, setTaxEnabled] = useState(Boolean(area?.tax));
  const [taxName, setTaxName] = useState(area?.tax?.name ?? "");
  const [taxRatePercent, setTaxRatePercent] = useState(
    area?.tax ? String(area.tax.ratePercent) : "",
  );
  const [defaultBusinessProfileId, setDefaultBusinessProfileId] = useState<string | null>(
    area?.defaultBusinessProfileId ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () =>
      serviceAreaFormSchema.safeParse({
        name,
        priority,
        active,
        timezone,
        type,
        zips: type === ServiceAreaType.ZIPS ? zips : [],
        vertices: type === ServiceAreaType.POLYGON ? vertices : [],
        callerId,
        taxEnabled,
        taxName,
        taxRatePercent,
        defaultBusinessProfileId,
        color,
      }),
    [
      name,
      priority,
      active,
      timezone,
      type,
      zips,
      vertices,
      callerId,
      taxEnabled,
      taxName,
      taxRatePercent,
      defaultBusinessProfileId,
      color,
    ],
  );
  const issueFor = (field: string) =>
    parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === field)?.message;
  const taxNameError = taxEnabled && taxName !== "" ? issueFor("taxName") : undefined;
  const taxRateError = taxEnabled && taxRatePercent !== "" ? issueFor("taxRatePercent") : undefined;

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body: Record<string, unknown> = toServiceAreaBody(parsed.data);
    // An untouched colour is left out, so a save never trips over an API
    // that has not learnt colours yet; a changed one is sent ("" clears).
    if (color === (area?.color ?? "")) delete body.color;
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  const numberOptions = (numbers ?? []).map((n) => ({
    value: n.phoneNumber,
    label: `${formatPhone(n.phoneNumber)}${n.friendlyName && n.friendlyName !== n.phoneNumber ? ` — ${n.friendlyName}` : ""}`,
  }));

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit Service area" : "Add New Service area"}
      onSave={submit}
      saving={pending}
      saveDisabled={!parsed.success}
      error={error}
      variant="full"
    >
      <WzTextField label="Name" value={name} onChange={(e) => setName(e.target.value)} overhang={false} />
      <WzTextField
        label="Priority"
        type="number"
        min={0}
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        overhang={false}
      />

      <WzColorDots label="Choose Color" shape="square" options={WZ_AREA_COLORS} value={color} onChange={setColor} />

      <div className="flex flex-col gap-1">
        <WzSelect
          label="Timezone"
          options={US_TIMEZONES}
          value={timezone}
          onChange={(v) => setTimezone(v || DEFAULT_TZ)}
          searchable={false}
        />
        <Hint>Jobs in this area show their schedule in this timezone.</Hint>
      </div>

      <div className="flex flex-col gap-1">
        {/* A picker, never free text: caller id is not validated at dial
            time, so a typo would surface weeks later as a client whose call
            simply hangs up. Cleared, the workspace default number is used. */}
        <WzSelect
          label="Client-facing number"
          options={numberOptions}
          value={callerId}
          valueLabel={callerId ? formatPhone(callerId) : undefined}
          onChange={setCallerId}
          clearable
        />
        <Hint>
          Clients on jobs in this territory are called from this number, and call it back. Leave it
          empty to use the workspace default.
        </Hint>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Sales tax</SectionLabel>
        <WzOnOffSwitch
          aria-label="Charge sales tax in this area"
          checked={taxEnabled}
          onCheckedChange={setTaxEnabled}
        />
        {taxEnabled ? (
          <div className="grid grid-cols-[2fr_1fr] gap-2.5">
            <WzTextField
              label="Tax name"
              value={taxName}
              maxLength={60}
              onChange={(e) => setTaxName(e.target.value)}
              error={taxNameError}
              overhang={false}
            />
            <WzTextField
              label="Tax rate (%)"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={0.001}
              value={taxRatePercent}
              onChange={(e) => setTaxRatePercent(e.target.value)}
              error={taxRateError}
              overhang={false}
            />
          </div>
        ) : (
          <Hint>No tax is charged on jobs in this area. On, it applies to jobs here unless the client is tax exempt.</Hint>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel htmlFor="service-area-default-company">Default company</SectionLabel>
        <BusinessProfileSelect
          id="service-area-default-company"
          aria-label="Default company"
          className="h-12"
          value={defaultBusinessProfileId}
          onChange={setDefaultBusinessProfileId}
          allowNone
          noneLabel="Account default company"
          placeholder="Account default company"
        />
        <Hint>New jobs in this area start with this company.</Hint>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Advanced area select</SectionLabel>
        <WzOnOffSwitch
          aria-label="Advanced area select"
          checked={type === ServiceAreaType.POLYGON}
          onCheckedChange={(on) => setType(on ? ServiceAreaType.POLYGON : ServiceAreaType.ZIPS)}
        />
        <Hint>Off: ZIP codes, each with a mile radius. On: draw the area on the map, dot by dot.</Hint>
      </div>

      {type === ServiceAreaType.ZIPS ? (
        <ZipListEditor value={zips} onChange={setZips} />
      ) : (
        <PolygonMapEditor value={vertices} onChange={setVertices} />
      )}
    </WzFormModal>
  );
}
