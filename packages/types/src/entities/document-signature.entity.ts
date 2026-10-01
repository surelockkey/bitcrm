/**
 * A client's signature on an estimate or invoice (Workiz `signatures[]`,
 * `image_type: sign_estimate | sign_invoice`). Taken remotely on the client
 * portal — an estimate is approved by signing it — or in person on the
 * technician's phone. The image is a billing asset; a document keeps every
 * signature it ever collected and prints the latest one.
 */
export const SIGNATURE_DOCUMENT_KINDS = ['estimate', 'invoice'] as const;
export type SignatureDocumentKind = (typeof SIGNATURE_DOCUMENT_KINDS)[number];

export const SIGNATURE_SOURCES = ['portal', 'app'] as const;
export type SignatureSource = (typeof SIGNATURE_SOURCES)[number];

export interface DocumentSignature {
  id: string;
  kind: SignatureDocumentKind;
  documentId: string;
  /** The document's job, when it has one. */
  dealId?: string;
  contactId: string;
  /** Billing asset holding the PNG/JPEG. */
  assetId: string;
  /** The name typed by the signer (Workiz "Signed By"). */
  signedBy: string;
  signedAt: string;
  source: SignatureSource;
  /** Staff user who collected an in-person (`app`) signature. */
  collectedBy?: string;
  /** Client address of a portal signature, kept as evidence. */
  ip?: string;
}

/** What the API returns: the asset replaced by a short-lived viewable URL. */
export interface DocumentSignatureView extends Omit<DocumentSignature, 'assetId'> {
  imageUrl: string;
}

/** A signature canvas exports a small PNG; a JPEG upload from the app is allowed too. */
export const SIGNATURE_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;
export const SIGNATURE_MAX_BYTES = 512 * 1024;
export const SIGNER_NAME_MAX_LENGTH = 120;
export const DECLINE_REASON_MAX_LENGTH = 1000;
