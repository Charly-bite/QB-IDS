/**
 * Auto-Scanner — Lightweight Background Ping Sweep
 * 
 * Runs periodic ping sweeps to detect new devices without the overhead
 * of a full deep scan. Uses the diff engine to generate alerts.
 * 
 * Singleton pattern: only one scanner instance runs at a time.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { initDatabase, createAlert } from '@/lib/db';
import { diffScanResults, generateAlerts, type ScanHost } from '@/lib/network-diff';

const execAsync = promisify(exec);

// ─── Singleton State ────────────────────────────────────────

interface AutoScannerState {
  running: boolean;
  intervalId: ReturnType<typeof setInterval> | null;
  lastScanTime: string | null;
  lastScanResult: {
    hostsFound: number;
    newAlerts: number;
  } | null;
  enabled: boolean;
  intervalMs: number;
  subnet: string;
}

const state: AutoScannerState = {
  running: false,
  intervalId: null,
  lastScanTime: null,
  lastScanResult: null,
  enabled: false,
  intervalMs: 30 * 60 * 1000, // 30 minutes default
  subnet: '192.168.2',
};

// ─── Quick Ping ─────────────────────────────────────────────

async function quickPing(ip: string): Promise<ScanHost> {
  try {
    const { stdout, stderr } = await execAsync(`ping -a -n 1 -w 1200 ${ip}`, { timeout: 6000 });
    const output = stdout + (stderr || '');
    
    const failPatterns = ['unreachable', 'inalcanzable', 'timed out', 'agot', 'could not find', 'perdidos = 1', '(100%'];
    const failed = failPatterns.some(p => output.toLowerCase().includes(p.toLowerCase()));
    
    if (failed) return { ip, status: 'Offline', latency: 0, hostname: null, ttl: null };

    let latency = 0;
    const timeMatch = output.match(/(?:time|tiempo)[=<]([0-9]+)\s*m/i);
    if (timeMatch?.[1]) latency = parseInt(timeMatch[1], 10);

    let hostname: string | null = null;
    const nameMatch = output.match(/(?:Pinging|Haciendo ping a)\s+(\S+)\s+\[/i);
    if (nameMatch?.[1] && nameMatch[1] !== ip) hostname = nameMatch[1];

    let ttl: number | null = null;
    const ttlMatch = output.match(/TTL[=:](\d+)/i);
    if (ttlMatch?.[1]) ttl = parseInt(ttlMatch[1], 10);

    return { ip, status: 'Online', latency, hostname, ttl };
  } catch {
    return { ip, status: 'Offline', latency: 0, hostname: null, ttl: null };
  }
}

// ─── Scan Execution ─────────────────────────────────────────

async function runQuickSweep(): Promise<{ hostsFound: number; newAlerts: number }> {
  console.log(`[AutoScanner] Starting quick sweep on ${state.subnet}.0/24...`);
  
  try {
    await initDatabase();
    
    // Build IP list
    const ips: string[] = [];
    for (let i = 1; i <= 254; i++) ips.push(`${state.subnet}.${i}`);
    
    // Ping sweep in parallel batches
    const results: ScanHost[] = [];
    const chunkSize = 40;
    for (let i = 0; i < ips.length; i += chunkSize) {
      const chunk = ips.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(quickPing));
      results.push(...chunkResults);
    }
    
    const onlineHosts = results.filter(h => h.status === 'Online');
    console.log(`[AutoScanner] Sweep done: ${onlineHosts.length} hosts online`);
    
    // Run diff against DB
    const diff = await diffScanResults(results);
    const alerts = generateAlerts(diff);
    
    let createdCount = 0;
    for (const alert of alerts) {
      const id = await createAlert(alert);
      if (id !== null) createdCount++;
    }
    
    if (createdCount > 0) {
      console.log(`[AutoScanner] Generated ${createdCount} new alerts (${diff.newDevices.length} new devices, ${diff.changedDevices.length} changed, ${diff.goneDevices.length} gone)`);
    }
    
    return { hostsFound: onlineHosts.length, newAlerts: createdCount };
  } catch (error) {
    console.error('[AutoScanner] Sweep failed:', error);
    return { hostsFound: 0, newAlerts: 0 };
  }
}

// ─── Public API ─────────────────────────────────────────────

/** Start the auto-scanner with the configured interval */
export function startAutoScanner(intervalMs?: number, subnet?: string): void {
  if (state.intervalId) {
    console.log('[AutoScanner] Already running, stopping previous instance');
    stopAutoScanner();
  }
  
  if (intervalMs) state.intervalMs = intervalMs;
  if (subnet) state.subnet = subnet;
  
  state.enabled = true;
  
  // Run immediately, then schedule
  state.running = true;
  runQuickSweep().then(result => {
    state.running = false;
    state.lastScanTime = new Date().toISOString();
    state.lastScanResult = result;
  });
  
  state.intervalId = setInterval(async () => {
    if (state.running) {
      console.log('[AutoScanner] Skipping sweep — previous one still running');
      return;
    }
    state.running = true;
    try {
      const result = await runQuickSweep();
      state.lastScanTime = new Date().toISOString();
      state.lastScanResult = result;
    } finally {
      state.running = false;
    }
  }, state.intervalMs);
  
  console.log(`[AutoScanner] Started — scanning every ${state.intervalMs / 60000} minutes`);
}

/** Stop the auto-scanner */
export function stopAutoScanner(): void {
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.enabled = false;
  console.log('[AutoScanner] Stopped');
}

/** Run a single sweep manually (doesn't affect the scheduled interval) */
export async function runManualSweep(): Promise<{ hostsFound: number; newAlerts: number }> {
  if (state.running) {
    return { hostsFound: 0, newAlerts: 0 }; // Already running
  }
  state.running = true;
  try {
    const result = await runQuickSweep();
    state.lastScanTime = new Date().toISOString();
    state.lastScanResult = result;
    return result;
  } finally {
    state.running = false;
  }
}

/** Get the current status of the auto-scanner */
export function getAutoScannerStatus(): {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  subnet: string;
  lastScanTime: string | null;
  lastScanResult: { hostsFound: number; newAlerts: number } | null;
} {
  return {
    enabled: state.enabled,
    running: state.running,
    intervalMinutes: state.intervalMs / 60000,
    subnet: state.subnet,
    lastScanTime: state.lastScanTime,
    lastScanResult: state.lastScanResult,
  };
}
