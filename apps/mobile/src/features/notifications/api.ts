import { http } from '../../lib/api/http';
import type { RegisterDeviceBody, RegisteredDevice } from './types';

/**
 * Put this phone on the list for the signed-in technician.
 *
 * `POST /api/messaging/devices` — the gateway's `/api` prefix is already on
 * `env.apiBaseUrl`, so the path here stops at `/messaging`. Registering a
 * token that is already registered is the ordinary case (the app does it on
 * every open, so the server can see which phones are still alive); the server
 * treats it as the same device and re-stamps `registeredAt`.
 */
export const registerDevice = (body: RegisterDeviceBody): Promise<RegisteredDevice> =>
  http.post<RegisteredDevice>('/messaging/devices', body);

/**
 * Take it off again — the van's phone gets handed to the next technician, and
 * nothing about the last one may follow it, least of all their job and chat
 * notifications.
 */
export const unregisterDevice = (token: string): Promise<{ token: string }> =>
  http.delete<{ token: string }>(`/messaging/devices/${encodeURIComponent(token)}`);
