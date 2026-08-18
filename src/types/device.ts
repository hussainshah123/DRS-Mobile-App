/**
 * A managed desktop, exactly as `api.deviceDTO` serializes it
 * (backend/internal/api/devices_handler.go).
 *
 * Note what this DTO does NOT contain: any agent secret, any capability flags, and no
 * indication of whether the agent was built with the VP8 codec. The transport a session
 * will actually use is therefore unknowable until the agent answers with `session_ready`
 * — which is why the session screen discovers its mode at runtime rather than deciding
 * it here (spec §20).
 */
export type DeviceStatus = 'online' | 'offline';

export type Device = {
  id: string;
  /** The agent-reported hostname. */
  name: string;
  /** Operator-assigned label, may be empty. */
  label: string;
  /** Assigned user, may be empty. */
  user: string;
  /** Human OS label, e.g. "Windows 11 (10.0.22631)". */
  os: string;
  ip: string;
  /** Driven by the live agent socket; flipped by the hub on connect/disconnect. */
  status: DeviceStatus;
  /** 0–100, zeroed by the backend when the device goes offline. */
  cpu: number;
  /** 0–100. */
  ram: number;
  /** Pre-humanized by the backend, e.g. "Just now" / "5 min ago" / "never". */
  last: string;
};

export function isOnline(device: Device): boolean {
  return device.status === 'online';
}

/**
 * deviceTitle prefers the operator's label over the raw hostname — the label is what
 * a person chose to call the machine, so it is what should appear in a session header
 * and in the audit-visible "you are controlling X" notice.
 */
export function deviceTitle(device: Device): string {
  return device.label?.trim() || device.name || device.id;
}

/**
 * deviceSubtitle is the secondary line: hostname when a label is displacing it,
 * otherwise the assigned user, otherwise the OS. Chosen so the two lines never repeat
 * the same string.
 */
export function deviceSubtitle(device: Device): string {
  if (device.label?.trim() && device.name) {
    return device.name;
  }
  return device.user?.trim() || device.os || '';
}

/** platformOf extracts a coarse platform from the human OS label, for the icon. */
export function platformOf(device: Device): 'windows' | 'darwin' | 'linux' | 'unknown' {
  const os = (device.os || '').toLowerCase();
  if (os.includes('windows')) {
    return 'windows';
  }
  if (os.includes('mac') || os.includes('darwin') || os.includes('os x')) {
    return 'darwin';
  }
  if (
    os.includes('linux') ||
    os.includes('ubuntu') ||
    os.includes('debian') ||
    os.includes('fedora') ||
    os.includes('arch')
  ) {
    return 'linux';
  }
  return 'unknown';
}
