/**
 * TCP Port Scanner — probes a host for common open ports.
 * Uses pure Node.js net.connect() — no external dependencies.
 */

import * as net from 'net';

export interface PortScanResult {
  ip: string;
  openPorts: number[];
  services: Record<number, string>;
}

// Top 20 most informative ports for device classification
const TARGET_PORTS: { port: number; service: string }[] = [
  { port: 22, service: 'SSH' },
  { port: 80, service: 'HTTP' },
  { port: 135, service: 'RPC' },
  { port: 139, service: 'NetBIOS' },
  { port: 161, service: 'SNMP' },
  { port: 443, service: 'HTTPS' },
  { port: 445, service: 'SMB' },
  { port: 515, service: 'LPR (Printer)' },
  { port: 554, service: 'RTSP (Camera)' },
  { port: 636, service: 'LDAPS' },
  { port: 1433, service: 'MSSQL' },
  { port: 3306, service: 'MySQL' },
  { port: 3389, service: 'RDP' },
  { port: 5000, service: 'Synology DSM' },
  { port: 5001, service: 'Synology HTTPS' },
  { port: 5432, service: 'PostgreSQL' },
  { port: 8080, service: 'HTTP-Alt' },
  { port: 8443, service: 'HTTPS-Alt' },
  { port: 9100, service: 'JetDirect (Printer)' },
  { port: 389, service: 'LDAP' },
];

/**
 * Probe a single port on a host.
 * Returns true if the port is open (TCP handshake completed).
 */
function probePort(ip: string, port: number, timeoutMs: number = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));

    socket.connect(port, ip);
  });
}

/**
 * Scan a single host for all target ports.
 * Scans ports in batches of 10 for performance.
 */
export async function scanHost(ip: string): Promise<PortScanResult> {
  const openPorts: number[] = [];
  const services: Record<number, string> = {};
  const batchSize = 10;

  for (let i = 0; i < TARGET_PORTS.length; i += batchSize) {
    const batch = TARGET_PORTS.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async ({ port, service }) => ({
        port,
        service,
        open: await probePort(ip, port),
      }))
    );

    for (const r of results) {
      if (r.open) {
        openPorts.push(r.port);
        services[r.port] = r.service;
      }
    }
  }

  return { ip, openPorts, services };
}

/**
 * Batch-scan multiple hosts. Scans hostsPerBatch hosts concurrently.
 */
export async function scanHosts(
  ips: string[],
  hostsPerBatch: number = 10,
  onProgress?: (done: number, total: number) => void
): Promise<PortScanResult[]> {
  const results: PortScanResult[] = [];

  for (let i = 0; i < ips.length; i += hostsPerBatch) {
    const batch = ips.slice(i, i + hostsPerBatch);
    const batchResults = await Promise.all(batch.map(scanHost));
    results.push(...batchResults);
    onProgress?.(Math.min(i + hostsPerBatch, ips.length), ips.length);
  }

  return results;
}

/**
 * Get a human-readable port summary string.
 * e.g., "22(SSH), 80(HTTP), 443(HTTPS)"
 */
export function formatPorts(result: PortScanResult): string {
  return result.openPorts
    .map(p => `${p}(${result.services[p] || '?'})`)
    .join(', ');
}
