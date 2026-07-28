/**
 * Network Diff Engine
 * 
 * Compares scan results against the known device inventory in the database.
 * Generates alerts for new devices, changed devices, and disappeared devices.
 */

import { getAllDevices, type AlertRecord } from '@/lib/db';

// ─── Types ──────────────────────────────────────────────────

export interface ScanHost {
  ip: string;
  status: 'Online' | 'Offline';
  latency: number;
  hostname: string | null;
  ttl: number | null;
  mac?: string | null;
  vendor?: string | null;
  openPorts?: number[];
  osFingerprint?: string | null;
  deviceType?: string | null;
}

export interface DeviceDiff {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface NewDeviceInfo {
  ip: string;
  hostname: string | null;
  mac: string | null;
  vendor: string | null;
  openPorts: number[];
  osFingerprint: string | null;
  deviceType: string | null;
}

export interface ChangedDeviceInfo {
  ip: string;
  name: string;
  changes: DeviceDiff[];
}

export interface GoneDeviceInfo {
  ip: string;
  name: string;
  lastSeen: string | null;
}

export interface NetworkDiffResult {
  newDevices: NewDeviceInfo[];
  changedDevices: ChangedDeviceInfo[];
  goneDevices: GoneDeviceInfo[];
  timestamp: string;
}

// ─── Severity Classification ────────────────────────────────

/** Ports that indicate high-risk services */
const CRITICAL_PORTS = [22, 23, 3389, 445, 1433, 3306, 5432, 5900, 5901];

/** Ports that indicate a device is actively serving */
const NOTABLE_PORTS = [80, 443, 8080, 8443, 21, 25, 110, 143, 53, 67, 68, 161];

function classifyNewDeviceSeverity(device: NewDeviceInfo): 'critical' | 'warning' | 'info' {
  const ports = device.openPorts || [];
  
  // Critical: Has high-risk ports exposed
  if (ports.some(p => CRITICAL_PORTS.includes(p))) {
    return 'critical';
  }
  
  // Critical: Has many open ports (potential rogue server)
  if (ports.length >= 5) {
    return 'critical';
  }
  
  // Warning: Has some notable ports or any open ports
  if (ports.length > 0) {
    return 'warning';
  }
  
  // Info: Just responding to ping (no port data)
  return 'warning';
}

function buildNewDeviceMessage(device: NewDeviceInfo): string {
  const parts: string[] = [];
  
  if (device.hostname) {
    parts.push(`hostname "${device.hostname}"`);
  }
  if (device.vendor) {
    parts.push(`vendor: ${device.vendor}`);
  }
  if (device.openPorts.length > 0) {
    const portStr = device.openPorts.slice(0, 5).join(', ');
    const extra = device.openPorts.length > 5 ? ` +${device.openPorts.length - 5} more` : '';
    parts.push(`ports: ${portStr}${extra}`);
  }
  if (device.osFingerprint) {
    parts.push(`OS: ${device.osFingerprint}`);
  }
  
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `New device detected at ${device.ip}${detail}`;
}

// ─── Diff Logic ─────────────────────────────────────────────

/**
 * Compare scan results against the device database.
 * Returns new, changed, and gone devices.
 */
export async function diffScanResults(scanResults: ScanHost[]): Promise<NetworkDiffResult> {
  // Get all known devices from DB
  const knownDevicesRaw = await getAllDevices();
  const knownDevices = knownDevicesRaw as {
    ip: string;
    name: string;
    status: string;
    hostname: string | null;
    mac_address: string | null;
    vendor: string | null;
    open_ports: string | null;
    os_fingerprint: string | null;
    device_type: string;
    last_seen: string | null;
  }[];
  
  // Build lookup by IP
  const knownByIp = new Map(knownDevices.map(d => [d.ip, d]));
  const scanByIp = new Map(scanResults.filter(h => h.status === 'Online').map(h => [h.ip, h]));
  
  const newDevices: NewDeviceInfo[] = [];
  const changedDevices: ChangedDeviceInfo[] = [];
  const goneDevices: GoneDeviceInfo[] = [];
  
  // Find NEW devices: in scan but not in DB
  for (const [ip, host] of scanByIp) {
    if (!knownByIp.has(ip)) {
      newDevices.push({
        ip,
        hostname: host.hostname,
        mac: host.mac || null,
        vendor: host.vendor || null,
        openPorts: host.openPorts || [],
        osFingerprint: host.osFingerprint || null,
        deviceType: host.deviceType || null,
      });
    }
  }
  
  // Find CHANGED devices: in both scan and DB, but properties differ
  for (const [ip, host] of scanByIp) {
    const known = knownByIp.get(ip);
    if (!known) continue;
    
    const changes: DeviceDiff[] = [];
    
    // Check OS change
    if (host.osFingerprint && known.os_fingerprint && 
        host.osFingerprint !== known.os_fingerprint) {
      changes.push({
        field: 'OS Fingerprint',
        oldValue: known.os_fingerprint,
        newValue: host.osFingerprint,
      });
    }
    
    // Check port changes (new ports opened)
    if (host.openPorts && host.openPorts.length > 0 && known.open_ports) {
      const knownPorts = new Set(known.open_ports.split(',').map(p => parseInt(p.trim())));
      const newPorts = host.openPorts.filter(p => !knownPorts.has(p));
      if (newPorts.length > 0) {
        changes.push({
          field: 'New Open Ports',
          oldValue: known.open_ports,
          newValue: host.openPorts.join(','),
        });
      }
    }
    
    // Check vendor change
    if (host.vendor && known.vendor && host.vendor !== known.vendor) {
      changes.push({
        field: 'Vendor',
        oldValue: known.vendor,
        newValue: host.vendor,
      });
    }
    
    if (changes.length > 0) {
      changedDevices.push({
        ip,
        name: known.name,
        changes,
      });
    }
  }
  
  // Find GONE devices: previously Online in DB but not in current scan
  // Only flag devices that were recently online (last 24 hours) 
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const [ip, known] of knownByIp) {
    if (known.status === 'Online' && !scanByIp.has(ip)) {
      const lastSeen = known.last_seen ? new Date(known.last_seen) : null;
      if (lastSeen && lastSeen > oneDayAgo) {
        goneDevices.push({
          ip,
          name: known.name,
          lastSeen: known.last_seen,
        });
      }
    }
  }
  
  return {
    newDevices,
    changedDevices,
    goneDevices,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate alert records from a diff result.
 */
export function generateAlerts(diff: NetworkDiffResult): AlertRecord[] {
  const alerts: AlertRecord[] = [];
  
  // Alerts for NEW devices
  for (const device of diff.newDevices) {
    const severity = classifyNewDeviceSeverity(device);
    alerts.push({
      alert_type: 'new_device',
      severity,
      ip: device.ip,
      device_name: device.hostname || device.vendor || null,
      message: buildNewDeviceMessage(device),
      details: JSON.stringify(device),
    });
  }
  
  // Alerts for CHANGED devices
  for (const device of diff.changedDevices) {
    // Check if any change involves critical ports
    const hasNewCriticalPorts = device.changes.some(c => 
      c.field === 'New Open Ports' && 
      c.newValue?.split(',').some(p => CRITICAL_PORTS.includes(parseInt(p.trim())))
    );
    
    alerts.push({
      alert_type: 'device_changed',
      severity: hasNewCriticalPorts ? 'critical' : 'info',
      ip: device.ip,
      device_name: device.name,
      message: `${device.name} (${device.ip}) changed: ${device.changes.map(c => c.field).join(', ')}`,
      details: JSON.stringify(device.changes),
    });
  }
  
  // Alerts for GONE devices (only if they were monitored or important)
  for (const device of diff.goneDevices) {
    alerts.push({
      alert_type: 'device_gone',
      severity: 'warning',
      ip: device.ip,
      device_name: device.name,
      message: `${device.name} (${device.ip}) is no longer responding (last seen: ${device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'unknown'})`,
      details: JSON.stringify(device),
    });
  }
  
  return alerts;
}
