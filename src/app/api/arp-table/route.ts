import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

export const dynamic = 'force-dynamic';

/**
 * GET /api/arp-table
 * 
 * Queries the LibreNMS MySQL database for ARP data collected during SNMP polling.
 * LibreNMS already polls the FortiGate and stores every IP→MAC mapping it discovers.
 * 
 * Query params:
 *   - subnet: filter to a specific subnet prefix (default: 192.168.2)
 *   - source: filter to a specific source device hostname (default: all)
 */

// LibreNMS DB connection config — use dynamic access to prevent build-time inlining
function getEnv(key: string, fallback: string): string {
  // Dynamic property access prevents Next.js from replacing at build time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (process as any).env as Record<string, string | undefined>;
  return env[key] || fallback;
}

function getDbConfig() {
  return {
    host: getEnv('LIBRENMS_DB_HOST', 'librenms_db'),
    port: parseInt(getEnv('LIBRENMS_DB_PORT', '3306')),
    user: getEnv('LIBRENMS_DB_USER', 'librenms'),
    password: getEnv('LIBRENMS_DB_PASSWORD', 'QuimicaB.2025$'),
    database: getEnv('LIBRENMS_DB_NAME', 'librenms'),
    connectTimeout: 10000,
  };
}

// Common MAC OUI prefixes → manufacturer
const OUI_DB: Record<string, string> = {
  // Networking — TP-Link
  'C0:74:AD': 'TP-Link', '38:AF:29': 'TP-Link', '60:CF:84': 'TP-Link',
  'D4:43:0E': 'TP-Link',
  // Cisco
  '00:1E:BD': 'Cisco', '00:26:0A': 'Cisco', '58:97:1E': 'Cisco',
  'F8:72:EA': 'Cisco', 'D0:C7:89': 'Cisco', '44:AD:D9': 'Cisco',
  '70:D3:79': 'Cisco', 'C0:67:AF': 'Cisco', '28:6F:7F': 'Cisco',
  '74:56:3C': 'Cisco Meraki',
  // Ubiquiti
  '74:83:C2': 'Ubiquiti', '80:2A:A8': 'Ubiquiti', 'FC:EC:DA': 'Ubiquiti',
  'DC:9F:DB': 'Ubiquiti', 'F0:9F:C2': 'Ubiquiti', '24:5A:4C': 'Ubiquiti',
  // MikroTik
  '00:0C:42': 'MikroTik', 'D4:CA:6D': 'MikroTik', '6C:3B:6B': 'MikroTik',
  '48:8F:5A': 'MikroTik', 'B8:69:F4': 'MikroTik', 'CC:2D:E0': 'MikroTik',
  '74:4D:28': 'MikroTik', 'E4:8D:8C': 'MikroTik',
  // Fortinet
  '00:09:0F': 'Fortinet', '70:4C:A5': 'Fortinet', '90:6C:AC': 'Fortinet',
  '94:F3:92': 'Fortinet',
  // Dell
  'EC:F4:BB': 'Dell', 'F8:DB:88': 'Dell', '14:FE:B5': 'Dell',
  '00:14:22': 'Dell', 'B8:2A:72': 'Dell', '18:66:DA': 'Dell',
  '34:17:EB': 'Dell', 'D4:AE:52': 'Dell', '38:14:28': 'Dell',
  'D8:5E:D3': 'Dell/EMC',
  // HP/HPE
  '00:25:B5': 'HP/HPE', '3C:D9:2B': 'HP/HPE', '3C:A8:2A': 'HP/HPE',
  'B4:B5:2F': 'HP/HPE', '94:57:A5': 'HP/HPE', 'A0:D3:C1': 'HP/HPE',
  'FC:15:B4': 'HP/HPE', 'D8:D3:85': 'HP/HPE', '08:F1:EA': 'HP/HPE',
  'BC:FC:E7': 'HP/HPE', '5C:BA:2C': 'HP/HPE', '64:51:06': 'HP/HPE',
  'EC:B1:D7': 'HP/HPE', 'F4:30:B9': 'HP/HPE', '58:11:22': 'HP/HPE',
  '80:CE:62': 'HP/HPE',
  // Intel
  '00:1E:67': 'Intel', 'A4:BF:01': 'Intel', '3C:97:0E': 'Intel',
  'F8:F2:1E': 'Intel', '68:05:CA': 'Intel', '48:21:0B': 'Intel',
  'E4:E2:6C': 'Intel', '50:76:AF': 'Intel', '9C:14:63': 'Intel',
  // VMware / Hyper-V
  '00:50:56': 'VMware', '00:0C:29': 'VMware', '00:15:5D': 'Hyper-V',
  // HikVision
  'C0:56:E3': 'HikVision', '44:19:B6': 'HikVision', 'C4:2F:90': 'HikVision',
  'BC:AD:28': 'HikVision', '28:57:BE': 'HikVision', 'A4:14:37': 'HikVision',
  '54:C4:15': 'HikVision', 'E0:50:8B': 'HikVision', 'BC:BA:C2': 'HikVision',
  'C0:51:7E': 'HikVision', 'E0:8F:4C': 'HikVision', 'EC:C8:9C': 'HikVision',
  'E4:A8:DF': 'HikVision', 'C0:6D:ED': 'HikVision',
  // Dahua
  '00:80:F0': 'Dahua', '3C:EF:8C': 'Dahua', 'A0:BD:1D': 'Dahua',
  // Apple
  'F0:18:98': 'Apple', 'AC:BC:32': 'Apple', '3C:22:FB': 'Apple',
  '14:98:77': 'Apple', 'A8:60:B6': 'Apple', 'F8:FF:C2': 'Apple',
  '38:F9:D3': 'Apple', 'E0:B5:2D': 'Apple', '7C:D1:C3': 'Apple',
  // Samsung
  '00:21:19': 'Samsung', 'C4:73:1E': 'Samsung', '10:D5:42': 'Samsung',
  '4C:D7:17': 'Samsung',
  // Printers
  '00:1B:A9': 'Brother', '00:80:77': 'Brother', '14:58:D0': 'Ricoh/NRG',
  '0C:71:8C': 'Kyocera', '30:E1:71': 'Kyocera',
  '00:00:48': 'Epson', '64:EB:8C': 'Epson',
  // NAS
  '00:11:32': 'Synology', '90:09:D0': 'Synology',
  // IoT
  'B8:27:EB': 'Raspberry Pi', 'DC:A6:32': 'Raspberry Pi',
  'E4:5F:01': 'Raspberry Pi',
  '08:BF:B8': 'ASUSTek',
  'E4:24:6C': 'Peplink',
  '00:1C:2A': 'Cisco Linksys',
  '00:0B:82': 'Grandstream',
  '00:E0:4C': 'Realtek', '90:3C:1D': 'Realtek',
  '24:DA:33': 'AzureWave', 'A4:D5:C2': 'Murata',
  '00:03:4F': 'Leunig GmbH',
  'D6:3E:23': 'Private MAC', 'FE:32:7B': 'Private MAC',
  'F2:63:81': 'Private MAC', 'FA:F2:52': 'Private MAC',
};

function lookupVendor(rawMac: string): string | null {
  if (!rawMac || rawMac.length < 6) return null;
  const mac = rawMac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (mac.length < 6) return null;
  const prefix = `${mac.slice(0, 2)}:${mac.slice(2, 4)}:${mac.slice(4, 6)}`;
  return OUI_DB[prefix] || null;
}

function formatMac(raw: string): string {
  const clean = raw.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  if (clean.length !== 12) return raw.toUpperCase();
  return `${clean.slice(0,2)}:${clean.slice(2,4)}:${clean.slice(4,6)}:${clean.slice(6,8)}:${clean.slice(8,10)}:${clean.slice(10,12)}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subnet = searchParams.get('subnet') || '192.168.2';
  const sourceFilter = searchParams.get('source') || '';

  let connection;
  try {
    connection = await mysql.createConnection(getDbConfig());
  } catch (connErr) {
    // If we can't connect directly (e.g. running on host, DB only reachable from Docker),
    // proxy the request to the Docker panel_control container on port 3000
    try {
      const proxyUrl = `http://localhost:3000/api/arp-table?subnet=${encodeURIComponent(subnet)}${sourceFilter ? `&source=${encodeURIComponent(sourceFilter)}` : ''}`;
      const proxyRes = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      const proxyData = await proxyRes.json();
      return NextResponse.json({ ...proxyData, source: proxyData.source + ' (proxied via Docker)' });
    } catch {
      return NextResponse.json(
        { error: `Cannot reach LibreNMS DB: ${connErr instanceof Error ? connErr.message : String(connErr)}` },
        { status: 500 }
      );
    }
  }

  try {

    // Query unique IP→MAC mappings, prioritizing gateway-seen entries
    let sql = `
      SELECT m.ipv4_address as ip, m.mac_address as mac, d.hostname as seen_by
      FROM ipv4_mac m
      LEFT JOIN ports p ON m.port_id = p.port_id
      LEFT JOIN devices d ON p.device_id = d.device_id
      WHERE m.ipv4_address LIKE ?
    `;
    const params: string[] = [`${subnet}.%`];

    if (sourceFilter) {
      sql += ' AND d.hostname = ?';
      params.push(sourceFilter);
    }

    sql += ' ORDER BY INET_ATON(m.ipv4_address), d.hostname';

    const [rows] = await connection.execute(sql, params) as [Array<{ ip: string; mac: string; seen_by: string }>, unknown];

    // Deduplicate by IP (prefer gateway entry)
    const ipMap = new Map<string, { ip: string; mac: string; vendor: string | null; seenBy: string }>();

    for (const row of rows) {
      const existing = ipMap.get(row.ip);
      if (!existing || row.seen_by === '192.168.2.1' || (!existing.seenBy?.includes('.1') && row.seen_by === '192.168.2.2')) {
        ipMap.set(row.ip, {
          ip: row.ip,
          mac: formatMac(row.mac),
          vendor: lookupVendor(row.mac),
          seenBy: row.seen_by || 'unknown',
        });
      }
    }

    const entries = Array.from(ipMap.values()).sort(
      (a, b) => {
        const aParts = a.ip.split('.').map(Number);
        const bParts = b.ip.split('.').map(Number);
        for (let i = 0; i < 4; i++) {
          if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
        }
        return 0;
      }
    );

    return NextResponse.json({
      count: entries.length,
      subnet,
      source: 'LibreNMS database (SNMP-collected ARP)',
      entries,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('ARP table error:', err);
    return NextResponse.json(
      { error: `Failed to query ARP table: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
