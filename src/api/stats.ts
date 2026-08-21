/**
 * The dashboard overview — `GET /api/stats/overview`, behind RequireAuth.
 *
 * One call, three payloads: the headline KPIs, the 7-day activity chart and the five
 * most-recently-seen devices (backend/internal/api/stats_handler.go assembles all of it
 * in a single handler). That is why this is the app's home screen rather than a screen
 * that fans out to three endpoints — on a cellular link the round-trip count is the
 * thing that decides whether a screen feels instant.
 *
 * Note what the backend has ALREADY done, so the client does not redo it:
 *
 *   • `availabilityPct` is computed and rounded server-side.
 *   • `offline` is a stored difference, not `total - online` re-derived here.
 *   • `activity[].value` is a 0–100 bar height, normalized so the busiest day is the
 *     tallest bar, with a floor so an empty day still renders a visible sliver. The
 *     chart must therefore plot `value` and label with `count` — plotting `count`
 *     directly would give a fleet with one busy day six invisible bars.
 *
 * `recentDevices` is the same `deviceDTO` the device list returns, so it renders through
 * the same DeviceCard with no translation.
 */
import type { Device } from '../types/device';
import { apiFetch } from './client';

/** Mirrors `api.kpisDTO`. */
export type OverviewKpis = {
  totalEndpoints: number;
  onlineNow: number;
  offline: number;
  /** 0–100, already rounded by the backend. */
  availabilityPct: number;
  /** Sessions with no `ended_at`. */
  activeSessions: number;
};

/** Mirrors `api.activityDTO`. One bar of the 7-day chart. */
export type ActivityDay = {
  /** Abbreviated weekday label, e.g. "Mon" — formatted by Postgres `to_char(day,'Dy')`. */
  day: string;
  /** Audit events recorded that day. This is the number to SHOW. */
  count: number;
  /** 0–100 bar height. This is the number to PLOT. */
  value: number;
};

/** Mirrors `api.overviewDTO`. */
export type Overview = {
  kpis: OverviewKpis;
  recentDevices: Device[];
  activity: ActivityDay[];
};

const emptyKpis: OverviewKpis = {
  totalEndpoints: 0,
  onlineNow: 0,
  offline: 0,
  availabilityPct: 0,
  activeSessions: 0,
};

/**
 * getOverview loads the whole home screen in one request.
 *
 * The response is normalized rather than trusted field-by-field. Go marshals a nil slice
 * as `null`, not `[]`, and while both slices here happen to be built with `make` today,
 * one `var out []T` on the server would turn `activity.map(...)` into a crash on the home
 * screen — the first screen after sign-in, and the worst place to have one.
 */
export async function getOverview(signal?: AbortSignal): Promise<Overview> {
  const data = await apiFetch<Partial<Overview>>('/api/stats/overview', { signal });
  return {
    kpis: { ...emptyKpis, ...(data?.kpis ?? {}) },
    recentDevices: Array.isArray(data?.recentDevices) ? data.recentDevices : [],
    activity: Array.isArray(data?.activity) ? data.activity : [],
  };
}
