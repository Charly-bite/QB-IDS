/**
 * SMB Share Scanner — enumerates shared folders on remote Windows hosts.
 * Uses `net view \\<ip> /all` to discover shared resources.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SharedFolder {
  name: string;
  type: 'Disk' | 'IPC' | 'Print' | 'Unknown';
  comment: string;
}

export interface SMBResult {
  ip: string;
  accessible: boolean;
  shares: SharedFolder[];
  error: string | null;
}

/**
 * Enumerate shared folders on a single host.
 * Uses `net view` which works for domain-joined machines.
 */
export async function enumShares(ip: string): Promise<SMBResult> {
  try {
    const { stdout } = await execAsync(`net view \\\\${ip} /all`, { timeout: 8000 });
    const lines = stdout.split('\n');
    const shares: SharedFolder[] = [];

    let inTable = false;
    for (const line of lines) {
      const trimmed = line.trim();

      // Detect table start (after the dashes separator)
      if (trimmed.startsWith('---')) {
        inTable = true;
        continue;
      }

      // Skip headers and empty lines
      if (!inTable || !trimmed || trimmed.startsWith('Se ha completado') || trimmed.startsWith('The command')) {
        continue;
      }

      // Parse share entry — format varies by locale:
      // English: ShareName   Disk   Description
      // Spanish: ShareName   Disco  Descripción
      const shareMatch = trimmed.match(
        /^(\S+)\s+(Disco|Disk|IPC|Impresión|Print|Impresi.n)\s*(.*)?$/i
      );
      if (shareMatch) {
        const name = shareMatch[1];
        const rawType = shareMatch[2].toLowerCase();
        const comment = (shareMatch[3] || '').trim();

        let type: SharedFolder['type'] = 'Unknown';
        if (rawType.includes('disco') || rawType.includes('disk')) type = 'Disk';
        else if (rawType.includes('ipc')) type = 'IPC';
        else if (rawType.includes('impres') || rawType.includes('print')) type = 'Print';

        shares.push({ name, type, comment });
      }
    }

    return { ip, accessible: true, shares, error: null };
  } catch (err) {
    // Check for common error codes
    const msg = err instanceof Error ? err.message : String(err);
    let error = 'Unknown error';
    if (msg.includes('Error de sistema 5') || msg.includes('Access is denied')) {
      error = 'Access denied';
    } else if (msg.includes('Error de sistema 53') || msg.includes('not found')) {
      error = 'Host not found';
    } else if (msg.includes('Error de sistema 1707') || msg.includes('network address')) {
      error = 'Invalid network address';
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      error = 'Timeout';
    }

    return { ip, accessible: false, shares: [], error };
  }
}

/**
 * Batch-enumerate shares on multiple hosts.
 * Only attempts on hosts with port 445 (SMB) open.
 */
export async function enumSharesBatch(
  ips: string[],
  batchSize: number = 5,
  onProgress?: (done: number, total: number) => void
): Promise<SMBResult[]> {
  const results: SMBResult[] = [];

  for (let i = 0; i < ips.length; i += batchSize) {
    const batch = ips.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(enumShares));
    results.push(...batchResults);
    onProgress?.(Math.min(i + batchSize, ips.length), ips.length);
  }

  return results;
}
