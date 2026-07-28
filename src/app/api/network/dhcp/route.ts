import { NextResponse } from 'next/server';
import { lookupVendor } from '@/lib/oui-lookup';

export const dynamic = 'force-dynamic';

interface FortiGateLease {
  ip: string;
  mac: string;
  hostname?: string;
  type?: string;
  expire?: number | string;
  interface?: string;
}

export async function GET() {
  const fgUrl = process.env.FORTIGATE_API_URL;
  const fgToken = process.env.FORTIGATE_API_TOKEN;

  if (!fgUrl || !fgToken) {
    // Return simulated leases matching typical network environments
    const mockLeases = [
      { ip: '192.168.2.10', mac: '00:15:5D:AA:BB:CC', hostname: 'WinServer-AD', type: 'reserved', expire: 'Never', interface: 'lan' },
      { ip: '192.168.2.55', mac: 'C0:74:AD:12:34:56', hostname: 'TP-Link-AP', type: 'dynamic', expire: new Date(Date.now() + 7200 * 1000).toISOString(), interface: 'lan' },
      { ip: '192.168.2.90', mac: '00:0B:82:99:88:77', hostname: 'GXP-Phone', type: 'dynamic', expire: new Date(Date.now() + 1800 * 1000).toISOString(), interface: 'lan' },
      { ip: '192.168.2.122', mac: 'C0:56:E3:44:33:22', hostname: 'HikCamera-01', type: 'reserved', expire: 'Never', interface: 'lan' },
      { ip: '192.168.2.205', mac: 'F0:9F:C2:55:66:77', hostname: 'Boss-Laptop', type: 'dynamic', expire: new Date(Date.now() + 28800 * 1000).toISOString(), interface: 'lan' },
    ];

    const leasesWithVendor = mockLeases.map(item => ({
      ...item,
      vendor: lookupVendor(item.mac)
    }));

    return NextResponse.json({
      configured: false,
      simulated: true,
      leases: leasesWithVendor,
      error: null
    });
  }

  // Bypasses SSL certificate check for local/internal APIs
  if (fgUrl.startsWith('https://192.168.') || fgUrl.startsWith('https://10.') || fgUrl.startsWith('https://172.')) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  try {
    const url = `${fgUrl}/monitor/system/dhcp/select?access_token=${fgToken}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({
        configured: true,
        simulated: false,
        leases: [],
        error: `FortiGate API returned status ${res.status}`
      }, { status: res.status });
    }

    const data = await res.json();
    const results = (data.results || []) as FortiGateLease[];

    const leases = results.map(item => {
      const macUpper = item.mac ? item.mac.toUpperCase() : '—';
      let expireDisplay = 'Never';

      if (item.type !== 'reserved' && item.expire) {
        if (typeof item.expire === 'number') {
          expireDisplay = new Date(Date.now() + item.expire * 1000).toISOString();
        } else {
          expireDisplay = String(item.expire);
        }
      }

      return {
        ip: item.ip,
        mac: macUpper,
        hostname: item.hostname || '—',
        type: item.type || 'dynamic',
        expire: expireDisplay,
        interface: item.interface || '—',
        vendor: lookupVendor(macUpper)
      };
    });

    return NextResponse.json({
      configured: true,
      simulated: false,
      leases,
      error: null
    });
  } catch (err) {
    return NextResponse.json({
      configured: true,
      simulated: false,
      leases: [],
      error: err instanceof Error ? err.message : String(err)
    }, { status: 500 });
  }
}
