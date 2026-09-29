/**
 * A piece of equipment on a job — Workiz's "Add equipment" form: what it is
 * (name, model, brand), how it is covered (labor and manufacturer warranty,
 * each valid through a date), and where it went in (serial, install date,
 * property address, location in the property, notes). It hangs off the job
 * and carries the job's client, so a client's equipment can be listed later.
 */
export interface DealEquipment {
  id: string;
  dealId: string;
  contactId: string;
  name: string;
  model: string;
  brand?: string;
  /** YYYY-MM-DD */
  laborWarrantyUntil?: string;
  /** YYYY-MM-DD */
  manufacturerWarrantyUntil?: string;
  serial?: string;
  /** YYYY-MM-DD */
  installedOn?: string;
  propertyAddress?: string;
  locationInProperty?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** The fields a person fills in; the rest the server sets. */
export type DealEquipmentInput = Pick<DealEquipment, 'name' | 'model'> &
  Partial<
    Pick<
      DealEquipment,
      | 'brand'
      | 'laborWarrantyUntil'
      | 'manufacturerWarrantyUntil'
      | 'serial'
      | 'installedOn'
      | 'propertyAddress'
      | 'locationInProperty'
      | 'notes'
    >
  >;
