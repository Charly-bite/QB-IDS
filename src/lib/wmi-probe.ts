/**
 * WMI System Profiler — queries remote Windows machines for full hardware/software inventory.
 * Uses `wmic /node:<ip>` to extract OS, CPU, RAM, Disk, NIC, and system info.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WMIProfile {
  ip: string;
  accessible: boolean;
  error: string | null;
  os: {
    caption: string | null;
    version: string | null;
    architecture: string | null;
    totalMemoryKB: number | null;
    freeMemoryKB: number | null;
  } | null;
  cpu: {
    name: string | null;
    cores: number | null;
    threads: number | null;
  } | null;
  system: {
    manufacturer: string | null;
    model: string | null;
    domain: string | null;
    loggedInUser: string | null;
    systemType: string | null;
  } | null;
  disks: {
    letter: string;
    fileSystem: string | null;
    totalBytes: number | null;
    freeBytes: number | null;
  }[] | null;
  nics: {
    name: string;
    mac: string | null;
    speedBps: number | null;
  }[] | null;
  bios: {
    manufacturer: string | null;
    version: string | null;
    serialNumber: string | null;
  } | null;
}

/**
 * Parse CSV output from WMIC command.
 * Returns array of row objects keyed by column headers.
 */
function parseWMICCSV(output: string): Record<string, string>[] {
  const lines = output
    .split(/\r?\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length >= headers.length) {
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = (values[j] || '').trim();
      }
      rows.push(row);
    }
  }
  return rows;
}

/**
 * Run a single WMIC query against a remote host.
 */
async function wmicQuery(ip: string, wmicClass: string, fields: string): Promise<Record<string, string>[]> {
  try {
    const cmd = `wmic /node:${ip} ${wmicClass} get ${fields} /format:csv`;
    const { stdout } = await execAsync(cmd, { timeout: 15000 });
    return parseWMICCSV(stdout);
  } catch {
    return [];
  }
}

/**
 * Query a single host for its full WMI profile.
 */
export async function queryWMI(ip: string): Promise<WMIProfile> {
  const profile: WMIProfile = {
    ip,
    accessible: false,
    error: null,
    os: null,
    cpu: null,
    system: null,
    disks: null,
    nics: null,
    bios: null,
  };

  try {
    // Run all queries in parallel for speed
    const [osRows, cpuRows, sysRows, diskRows, nicRows, biosRows] = await Promise.all([
      wmicQuery(ip, 'os', 'caption,version,osarchitecture,totalvisiblememorysize,freephysicalmemory'),
      wmicQuery(ip, 'cpu', 'name,numberofcores,numberoflogicalprocessors'),
      wmicQuery(ip, 'computersystem', 'manufacturer,model,domain,username,systemtype'),
      wmicQuery(ip, 'logicaldisk', 'name,filesystem,size,freespace'),
      wmicQuery(ip, 'nic where (netenabled=true)', 'name,macaddress,speed'),
      wmicQuery(ip, 'bios', 'manufacturer,smbiosbiosversion,serialnumber'),
    ]);

    // OS
    if (osRows.length > 0) {
      const r = osRows[0];
      profile.os = {
        caption: r['Caption'] || null,
        version: r['Version'] || null,
        architecture: r['OSArchitecture'] || null,
        totalMemoryKB: r['TotalVisibleMemorySize'] ? parseInt(r['TotalVisibleMemorySize']) : null,
        freeMemoryKB: r['FreePhysicalMemory'] ? parseInt(r['FreePhysicalMemory']) : null,
      };
      profile.accessible = true;
    }

    // CPU
    if (cpuRows.length > 0) {
      const r = cpuRows[0];
      profile.cpu = {
        name: r['Name'] || null,
        cores: r['NumberOfCores'] ? parseInt(r['NumberOfCores']) : null,
        threads: r['NumberOfLogicalProcessors'] ? parseInt(r['NumberOfLogicalProcessors']) : null,
      };
      profile.accessible = true;
    }

    // System
    if (sysRows.length > 0) {
      const r = sysRows[0];
      profile.system = {
        manufacturer: r['Manufacturer'] || null,
        model: r['Model'] || null,
        domain: r['Domain'] || null,
        loggedInUser: r['UserName'] || null,
        systemType: r['SystemType'] || null,
      };
      profile.accessible = true;
    }

    // Disks
    if (diskRows.length > 0) {
      profile.disks = diskRows
        .filter(r => r['Name'] && r['Size'])
        .map(r => ({
          letter: r['Name'],
          fileSystem: r['FileSystem'] || null,
          totalBytes: r['Size'] ? parseInt(r['Size']) : null,
          freeBytes: r['FreeSpace'] ? parseInt(r['FreeSpace']) : null,
        }));
      profile.accessible = true;
    }

    // NICs
    if (nicRows.length > 0) {
      profile.nics = nicRows
        .filter(r => r['Name'])
        .map(r => ({
          name: r['Name'],
          mac: r['MACAddress'] || null,
          speedBps: r['Speed'] ? parseInt(r['Speed']) : null,
        }));
      profile.accessible = true;
    }

    // BIOS
    if (biosRows.length > 0) {
      const r = biosRows[0];
      profile.bios = {
        manufacturer: r['Manufacturer'] || null,
        version: r['SMBIOSBIOSVersion'] || null,
        serialNumber: r['SerialNumber'] || null,
      };
      profile.accessible = true;
    }

    if (!profile.accessible) {
      profile.error = 'No data returned — access may be denied';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    profile.error = msg.includes('Acceso denegado') || msg.includes('Access is denied')
      ? 'Access denied'
      : msg.includes('RPC') ? 'RPC unavailable'
      : `WMI error: ${msg.substring(0, 100)}`;
  }

  return profile;
}

/**
 * Batch-query multiple hosts for WMI profiles.
 * Runs sequentially to avoid overwhelming WMIC.
 */
export async function queryWMIBatch(
  ips: string[],
  batchSize: number = 3,
  onProgress?: (done: number, total: number) => void
): Promise<WMIProfile[]> {
  const results: WMIProfile[] = [];

  for (let i = 0; i < ips.length; i += batchSize) {
    const batch = ips.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(queryWMI));
    results.push(...batchResults);
    onProgress?.(Math.min(i + batchSize, ips.length), ips.length);
  }

  return results;
}
