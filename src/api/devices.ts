/**
 * Device inventory. `GET /api/devices` and `GET /api/devices/{id}`, both behind
 * RequireAuth.
 *
 * Authorization note (spec §13: "do not allow a mobile user to access arbitrary
 * devices"): scoping is the BACKEND's job and it is enforced where it matters — at
 * `/ws/session`, which rejects any non-admin token before the upgrade. This client
 * shows what the API returns for the signed-in token and never tries to widen it; if
 * the fleet should be narrowed per operator, that filter belongs in
 * store.ListDevices, not here, or a device would remain reachable by anyone who could
 * guess its id.
 */
import type { Device } from '../types/device';
import { apiFetch } from './client';

/**
 * listDevices returns the fleet visible to the signed-in operator.
 *
 * `signal` is passed through so the device screen's poll can be abandoned on unmount —
 * without it, a 5-second poll against a slow backend keeps firing setState on a torn-down
 * screen.
 */
export function listDevices(signal?: AbortSignal): Promise<Device[]> {
  return apiFetch<Device[]>('/api/devices', { signal });
}

/**
 * getDevice re-reads one device. The details screen polls this so the online/offline
 * badge and the CPU/RAM meters stay live while the operator decides whether to connect.
 *
 * Throws ApiError with status 404 when the device no longer exists.
 */
export function getDevice(id: string, signal?: AbortSignal): Promise<Device> {
  return apiFetch<Device>(`/api/devices/${encodeURIComponent(id)}`, { signal });
}
