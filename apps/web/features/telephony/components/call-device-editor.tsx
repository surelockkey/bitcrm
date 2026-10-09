"use client";

import { useState } from "react";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzCheckbox } from "@/components/workiz/toggles";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { CALL_DEVICE_LIMITS, CALL_DEVICE_TYPES, type CallDevice, type CallDeviceType } from "@bitcrm/types";
import { useCreateCallDevice, useUpdateCallDevice } from "../call-devices-hooks";

/** A device's kind in words — the Devices grid's Type column and the modal's select. */
export const DEVICE_TYPE_LABEL: Record<CallDeviceType, string> = {
  desk_phone: "Desk phone",
  shop_line: "Shop line",
  mobile: "Mobile",
  other: "Other",
};

const TYPE_OPTIONS = CALL_DEVICE_TYPES.map((t) => ({ value: t, label: DEVICE_TYPE_LABEL[t] }));

/**
 * Add or edit one device — the Devices tab's modal. Workiz's own was never
 * captured (its Devices tab stayed on "Loading": the read is gated), so this
 * is the settings modal every other catalog uses (WzFormModal, 500px):
 * Device name, the number it rings on — or a SIP address for a desk phone
 * that registers somewhere else — its kind, and Active.
 *
 * The number goes to the server as E.164; on an edit an emptied number or
 * SIP address is sent as null so the server clears it.
 */
export function CallDeviceEditor({
  device,
  open,
  onClose,
}: {
  /** Absent = adding a new device. */
  device?: CallDevice;
  open: boolean;
  onClose: () => void;
}) {
  const editing = !!device;
  const [name, setName] = useState(device?.name ?? "");
  const [number, setNumber] = useState(device?.number ? formatPhone(device.number) || device.number : "");
  const [sipAddress, setSipAddress] = useState(device?.sipAddress ?? "");
  const [type, setType] = useState<CallDeviceType>(device?.type ?? "desk_phone");
  const [active, setActive] = useState(device?.active ?? true);

  const create = useCreateCallDevice();
  const update = useUpdateCallDevice(device?.id ?? "");

  const e164 = number.trim() ? normalizePhone(number) : null;
  const numberBad = number.trim() !== "" && !e164;
  const sip = sipAddress.trim();
  const canSave = name.trim() !== "" && !numberBad && (!!e164 || sip !== "");

  const save = async () => {
    if (!canSave) return;
    if (editing) {
      await update.mutateAsync({ name: name.trim(), number: e164 ?? null, sipAddress: sip || null, type, active });
    } else {
      await create.mutateAsync({
        name: name.trim(),
        ...(e164 && { number: e164 }),
        ...(sip && { sipAddress: sip }),
        type,
        active,
      });
    }
    onClose();
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? "Edit device" : "Add device"}
      description="A desk phone or shop line a call group or a call flow can ring. Nobody in the CRM answers it, so who picked up is not tracked."
      onSave={() => void save().catch(() => undefined)}
      saving={create.isPending || update.isPending}
      saveDisabled={!canSave}
    >
      <WzOutlinedTextField
        label="Device name"
        value={name}
        maxLength={CALL_DEVICE_LIMITS.nameMaxLength}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <WzOutlinedTextField
        label="Phone number"
        type="tel"
        value={number}
        error={numberBad ? "Not a phone number" : undefined}
        onChange={(e) => setNumber(e.target.value)}
      />
      <WzOutlinedTextField
        label="SIP address"
        placeholder="phone@sip.example.com"
        value={sipAddress}
        onChange={(e) => setSipAddress(e.target.value)}
      />
      <WzOutlinedSelect label="Type" options={TYPE_OPTIONS} value={type} onChange={(v) => setType(v as CallDeviceType)} />
      <div>
        <WzCheckbox label="Active" checked={active} onCheckedChange={setActive} />
        <p className="mt-1 pl-[28px] text-[13px] leading-[19px] tracking-[0.4px] text-wz-slate">
          A paused device keeps its place in groups and flows but is not rung.
        </p>
      </div>
    </WzFormModal>
  );
}
