/**
 * ARP Watch — monitors the ARP table for rogue devices, MAC changes, and anomalies.
 * Compares current ARP table against a known-good baseline stored in DB.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { lookupVendor } from './oui-lookup';

const execAsync = promisify(exec);

export interface ARPEntry {
  ip: string;
  mac: string;
  vendor: string | null;
}

export interface ARPAlert {
  type: 'new_device' | 'mac_change' | 'duplicate_ip' | 'vendor_anomaly';
  severity: 'info' | 'warning' | 'critical';
  ip: string;
  mac: string;
  vendor: string | null;
  message: string;
  details: string;
  timestamp: string;
}

/**
 * Parse the current ARP table from the system.
 */
export async function getCurrentARPTable(): Promise<ARPEntry[]> {
  const entries: ARPEntry[] = [];
  try {
    const { stdout } = await execAsync('arp -a', { timeout: 5000 });
    const lines = stdout.split('\n');
    for (const line of lines) {
      const match = line.match(
        /\s+([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})/
      );
      if (match && match[1] && match[2]) {
        const mac = match[2].toUpperCase();
        // Skip broadcast and multicast MACs
        if (mac === 'FF-FF-FF-FF-FF-FF' || mac.startsWith('01-00-5E')) continue;
        entries.push({
          ip: match[1],
          mac,
          vendor: lookupVendor(mac),
        });
      }
    }
  } catch { /* ignore */ }
  return entries;
}

/**
 * Compare current ARP table against a known baseline.
 * Returns security alerts for any anomalies detected.
 */
export function compareARPTables(
  current: ARPEntry[],
  baseline: ARPEntry[]
): ARPAlert[] {
  const alerts: ARPAlert[] = [];
  const now = new Date().toISOString();

  // Build lookup maps
  const baselineByIP: Record<string, ARPEntry> = {};
  const baselineByMAC: Record<string, ARPEntry> = {};
  for (const e of baseline) {
    baselineByIP[e.ip] = e;
    baselineByMAC[e.mac] = e;
  }

  const currentByIP: Record<string, ARPEntry[]> = {};
  for (const e of current) {
    if (!currentByIP[e.ip]) currentByIP[e.ip] = [];
    currentByIP[e.ip].push(e);
  }

  for (const entry of current) {
    const known = baselineByIP[entry.ip];

    // Check 1: New device (IP not seen before)
    if (!known) {
      alerts.push({
        type: 'new_device',
        severity: 'info',
        ip: entry.ip,
        mac: entry.mac,
        vendor: entry.vendor,
        message: `New device detected: ${entry.ip}`,
        details: `MAC: ${entry.mac} (${entry.vendor || 'Unknown vendor'})`,
        timestamp: now,
      });
      continue;
    }

    // Check 2: MAC address changed (potential ARP spoofing!)
    if (known.mac !== entry.mac) {
      alerts.push({
        type: 'mac_change',
        severity: 'critical',
        ip: entry.ip,
        mac: entry.mac,
        vendor: entry.vendor,
        message: `⚠️ MAC change detected on ${entry.ip}!`,
        details: `Was: ${known.mac} (${known.vendor || '?'}) → Now: ${entry.mac} (${entry.vendor || '?'}). Possible ARP spoofing!`,
        timestamp: now,
      });
    }
  }

  // Check 3: Duplicate IPs (multiple MACs claiming same IP)
  for (const [ip, entries] of Object.entries(currentByIP)) {
    if (entries.length > 1) {
      const macs = entries.map(e => `${e.mac} (${e.vendor || '?'})`).join(', ');
      alerts.push({
        type: 'duplicate_ip',
        severity: 'critical',
        ip,
        mac: entries[0].mac,
        vendor: entries[0].vendor,
        message: `Duplicate IP conflict: ${ip}`,
        details: `Multiple MACs claim this IP: ${macs}`,
        timestamp: now,
      });
    }
  }

  return alerts;
}

// Store the baseline in globalThis for persistence across module reloads
const BASELINE_KEY = '__panelcontrol_arp_baseline__';

export function setARPBaseline(entries: ARPEntry[]): void {
  (globalThis as Record<string, unknown>)[BASELINE_KEY] = entries;
}

export function getARPBaseline(): ARPEntry[] {
  return ((globalThis as Record<string, unknown>)[BASELINE_KEY] as ARPEntry[]) || [];
}

/**
 * Run a full ARP watch cycle: get current table, compare to baseline, update baseline.
 */
export async function runARPWatch(): Promise<{ alerts: ARPAlert[]; currentEntries: number }> {
  const current = await getCurrentARPTable();
  const baseline = getARPBaseline();

  let alerts: ARPAlert[] = [];
  if (baseline.length > 0) {
    alerts = compareARPTables(current, baseline);
  }

  // Update baseline
  setARPBaseline(current);

  return { alerts, currentEntries: current.length };
}
