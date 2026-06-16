/**
 * NetBIOS Scanner — queries remote hosts for NetBIOS name tables.
 * Uses Windows `nbtstat -A <ip>` to extract computer name, domain/workgroup, and services.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface NetBIOSResult {
  ip: string;
  computerName: string | null;
  domain: string | null;
  isFileServer: boolean;   // Has <20> service (SMB file sharing active)
  mac: string | null;      // MAC from nbtstat (backup source)
}

/**
 * Query a single host for its NetBIOS name table.
 * Parses the Spanish/English nbtstat output.
 */
export async function queryNetBIOS(ip: string): Promise<NetBIOSResult> {
  const result: NetBIOSResult = {
    ip,
    computerName: null,
    domain: null,
    isFileServer: false,
    mac: null,
  };

  try {
    const { stdout } = await execAsync(`nbtstat -A ${ip}`, { timeout: 5000 });
    const lines = stdout.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Match NetBIOS name entries:
      // QB_WFS_002     <00>  Único       Registrado
      // QBOSS          <00>  Grupo       Registrado
      // QB_WFS_002     <20>  Único       Registrado
      const nameMatch = trimmed.match(
        /^(.{1,15}?)\s+<([0-9a-fA-F]{2})>\s+(?:Único|Unique|UNIQUE|ÚNICO)\s+(?:Registrado|Registered)/i
      );
      if (nameMatch) {
        const name = nameMatch[1].trim();
        const type = nameMatch[2].toUpperCase();
        if (type === '00' && !result.computerName) {
          result.computerName = name;
        }
        if (type === '20') {
          result.isFileServer = true;
        }
      }

      // Match group entries (domain/workgroup)
      const groupMatch = trimmed.match(
        /^(.{1,15}?)\s+<([0-9a-fA-F]{2})>\s+(?:Grupo|Group|GROUP)\s+(?:Registrado|Registered)/i
      );
      if (groupMatch) {
        const name = groupMatch[1].trim();
        const type = groupMatch[2].toUpperCase();
        if (type === '00' && !result.domain) {
          result.domain = name;
        }
      }

      // Match MAC address line
      const macMatch = trimmed.match(
        /(?:Direcci[oó]n MAC|MAC Address)\s*=\s*([0-9A-Fa-f]{2}[-:][0-9A-Fa-f]{2}[-:][0-9A-Fa-f]{2}[-:][0-9A-Fa-f]{2}[-:][0-9A-Fa-f]{2}[-:][0-9A-Fa-f]{2})/i
      );
      if (macMatch) {
        result.mac = macMatch[1].toUpperCase();
      }
    }
  } catch {
    // Timeout or host unreachable — return empty result
  }

  return result;
}

/**
 * Batch-query multiple hosts for NetBIOS names.
 */
export async function queryNetBIOSBatch(
  ips: string[],
  batchSize: number = 10,
  onProgress?: (done: number, total: number) => void
): Promise<NetBIOSResult[]> {
  const results: NetBIOSResult[] = [];

  for (let i = 0; i < ips.length; i += batchSize) {
    const batch = ips.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(queryNetBIOS));
    results.push(...batchResults);
    onProgress?.(Math.min(i + batchSize, ips.length), ips.length);
  }

  return results;
}
