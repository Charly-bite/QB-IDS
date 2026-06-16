import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Helper to run a fast ping
async function checkHost(ip: string): Promise<{ ip: string; status: 'Online' | 'Offline' }> {
  try {
    // Fast ping: 1 packet, 500ms timeout
    const { stdout, stderr } = await execAsync(`ping -n 1 -w 500 ${ip}`);
    const output = stdout + (stderr || '');
    
    const failPatterns = ['unreachable', 'inalcanzable', 'timed out', 'agot', 'could not find', 'perdidos = 1'];
    const failed = failPatterns.some(p => output.toLowerCase().includes(p.toLowerCase()));
    
    return { ip, status: failed ? 'Offline' : 'Online' };
  } catch {
    return { ip, status: 'Offline' };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subnet = searchParams.get('subnet'); // e.g. "192.168.2"

  if (!subnet || !subnet.match(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/)) {
    return NextResponse.json({ error: 'Invalid subnet format. Expected e.g. 192.168.2' }, { status: 400 });
  }

  // To prevent the API from hanging too long, let's limit the scan to common IPs or chunk it.
  // We will scan 1 to 254 in chunks of 50.
  const ips = [];
  for (let i = 1; i <= 254; i++) {
    ips.push(`${subnet}.${i}`);
  }

  const results: { ip: string; status: 'Online' | 'Offline' }[] = [];
  
  // Process in chunks to avoid overwhelming the OS process limit
  const chunkSize = 50;
  for (let i = 0; i < ips.length; i += chunkSize) {
    const chunk = ips.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(checkHost));
    results.push(...chunkResults);
  }

  const activeHosts = results.filter(r => r.status === 'Online').map(r => r.ip);

  return NextResponse.json({
    subnet: `${subnet}.0/24`,
    scanned: 254,
    activeCount: activeHosts.length,
    activeHosts
  });
}
