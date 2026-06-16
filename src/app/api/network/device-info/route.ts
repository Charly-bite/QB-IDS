import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DeviceInfo {
  ip: string;
  hostname: string | null;
  mac: string | null;
}

// Get hostname from nbtstat
async function getHostname(ip: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`nbtstat -A ${ip}`, { timeout: 5000 });
    // Look for the first <00> UNIQUE entry — that's the NetBIOS name
    const match = stdout.match(/\s+(\S+)\s+<00>\s+.*[uú]nico/i) || stdout.match(/\s+(\S+)\s+<00>\s+.*UNIQUE/i);
    if (match && match[1]) return match[1].trim();
    return null;
  } catch {
    return null;
  }
}

// Get MAC from ARP table (must ping first)
async function getMac(ip: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`arp -a ${ip}`, { timeout: 3000 });
    // Match MAC address patterns like 5c-ba-2c-16-a8-d8 or 5c:ba:2c:16:a8:d8
    const match = stdout.match(/([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})/);
    if (match && match[1]) return match[1].toUpperCase();
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ip = searchParams.get('ip');

  if (!ip || !ip.match(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/)) {
    return NextResponse.json({ error: 'Invalid IP' }, { status: 400 });
  }

  try {
    // Run hostname and MAC lookups in parallel
    const [hostname, mac] = await Promise.all([
      getHostname(ip),
      getMac(ip),
    ]);

    const info: DeviceInfo = { ip, hostname, mac };
    return NextResponse.json(info);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ ip, hostname: null, mac: null, error: msg });
  }
}
