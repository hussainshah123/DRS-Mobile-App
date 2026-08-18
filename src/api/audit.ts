/**
 * The append-only security log — `GET /api/audit`, behind RequireAuth.
 *
 * This matters more on mobile than it might look. Every session this app opens, and every
 * remote-control grant it requests, is written to this log by the backend before it reaches the
 * agent (ws/session.go's auditSession / auditControl). Surfacing it in the app means an operator can
 * see their own footprint from the same device they made it with — which is the difference between
 * "the system claims it audits" and "I can read what it recorded about me".
 *
 * The backend caps a response at 200 events, newest first, and pre-formats the timestamp.
 */
import { apiFetch } from './client';

/** Mirrors `api.auditEventDTO`. `time` is already formatted server-side ("Jan 2 15:04"). */
export type AuditEvent = {
  time: string;
  user: string;
  action: string;
  device: string;
  type: string;
};

export function listAudit(signal?: AbortSignal): Promise<AuditEvent[]> {
  return apiFetch<AuditEvent[]>('/api/audit', { signal });
}

/**
 * Tone for an event's badge. Control grants are the events an auditor cares about most, so they are
 * the only ones rendered in the alarm colour — a log where everything is highlighted highlights
 * nothing.
 */
export function auditTone(event: AuditEvent): 'control' | 'session' | 'auth' | 'neutral' {
  const action = event.action.toLowerCase();
  if (action.includes('control')) {
    return 'control';
  }
  if (event.type === 'session' || action.includes('session') || action.includes('agent')) {
    return 'session';
  }
  if (action.includes('login') || action.includes('sign') || action.includes('password')) {
    return 'auth';
  }
  return 'neutral';
}
