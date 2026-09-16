import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Getting a photo onto the queue.
 *
 * The camera hands back a file in a cache directory the OS may delete at any
 * moment. A photo that is queued for upload has to outlive that — sometimes by
 * days, if the technician is working somewhere with no signal — so every
 * capture is copied into the app's own documents directory first, and the
 * queue only ever points at that copy (docs/ARCHITECTURE.md §2.3).
 */

/** What `POST /deals/:id/attachments` will accept (upload-attachment.dto.ts:12-15). */
export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
  pdf: 'application/pdf',
};

/**
 * The content type to declare.
 *
 * The server validates this against a fixed regex and 400s anything else, so a
 * type it has never heard of is better reported as JPEG — which is what every
 * phone camera actually produces — than as a rejected upload the technician
 * cannot explain.
 */
export function normalizeContentType(
  mimeType: string | null | undefined,
  uri: string,
): string {
  const declared = (mimeType ?? '').toLowerCase().split(';')[0]!.trim();
  if ((ALLOWED_CONTENT_TYPES as readonly string[]).includes(declared)) {
    return declared;
  }
  const extension = uri.split('?')[0]!.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[extension] ?? 'image/jpeg';
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

/**
 * A file name a dispatcher can make sense of in the job's attachment list:
 * the job, then when it was taken. The camera's own name is a serial number.
 */
export function buildFileName(
  dealId: string,
  contentType: string,
  takenAt: Date,
): string {
  const stamp = takenAt
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const extension = EXTENSIONS[contentType] ?? 'jpg';
  return `job-${dealId}-${stamp}.${extension}`;
}

export interface CapturedPhoto {
  localUri: string;
  fileName: string;
  contentType: string;
  size?: number;
}

/**
 * Where captures live until they have been uploaded — and until the queue
 * sweeps them afterwards (`sweepOrphanedPhotos`, queue/transport.ts). Named
 * here so the sweep and the capture cannot drift apart.
 */
export const PHOTO_DIRECTORY = 'job-photos';

function photoDirectory(): Directory {
  const dir = new Directory(Paths.document, PHOTO_DIRECTORY);
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function keep(
  asset: ImagePicker.ImagePickerAsset,
  dealId: string,
): Promise<CapturedPhoto> {
  const contentType = normalizeContentType(asset.mimeType, asset.uri);
  const fileName = buildFileName(dealId, contentType, new Date());
  const destination = new File(photoDirectory(), fileName);
  await new File(asset.uri).copy(destination, { overwrite: true });
  return {
    localUri: destination.uri,
    fileName,
    contentType,
    size: asset.fileSize ?? destination.size ?? undefined,
  };
}

/** Take a photo. Resolves null when the technician backs out or says no. */
export async function capturePhoto(dealId: string): Promise<CapturedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    // Compression is ours to choose — the attachment endpoint sets no size
    // limit — and 0.7 keeps a job photo readable on a fraction of the data a
    // technician may be paying for.
    quality: 0.7,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  return keep(result.assets[0], dealId);
}

/** Pick one already on the phone — a photo taken before the app was opened. */
export async function pickPhoto(dealId: string): Promise<CapturedPhoto | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    exif: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  return keep(result.assets[0], dealId);
}
