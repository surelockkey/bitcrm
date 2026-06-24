export interface Address {
  street: string;
  unit?: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
}
