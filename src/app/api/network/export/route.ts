/**
 * Export API — exports all network devices as CSV or JSON.
 */

import { NextResponse } from 'next/server';
import { getPool, initDatabase } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';

    await initDatabase();
    const p = await getPool();
    const result = await p.request().query(`
      SELECT ip, name, status, latency, mac_address, vendor, device_type,
             hostname, os_fingerprint, open_ports, ttl, netbios_name, domain,
             shared_folders, http_title, http_server, is_monitored,
             last_seen, created_at, subnet
      FROM NetworkDevices
      ORDER BY
        CASE WHEN is_monitored = 1 THEN 0 ELSE 1 END,
        ip
    `);

    const devices = result.recordset;

    if (format === 'json') {
      return NextResponse.json({ devices, exportedAt: new Date().toISOString() });
    }

    // CSV format
    const headers = [
      'IP', 'Name', 'Status', 'Latency (ms)', 'MAC Address', 'Vendor',
      'Type', 'Hostname', 'NetBIOS Name', 'Domain', 'OS', 'Open Ports',
      'HTTP Title', 'HTTP Server', 'Shared Folders', 'TTL', 'Monitored',
      'Last Seen', 'First Discovered', 'Subnet'
    ];

    const escapeCSV = (val: string | null | undefined | number | boolean): string => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = devices.map(d => [
      d.ip,
      d.name,
      d.status,
      d.latency,
      d.mac_address,
      d.vendor,
      d.device_type,
      d.hostname,
      d.netbios_name,
      d.domain,
      d.os_fingerprint,
      d.open_ports,
      d.http_title,
      d.http_server,
      d.shared_folders,
      d.ttl,
      d.is_monitored ? 'Yes' : 'No',
      d.last_seen ? new Date(d.last_seen).toLocaleString() : '',
      d.created_at ? new Date(d.created_at).toLocaleString() : '',
      d.subnet,
    ].map(escapeCSV).join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="network_devices_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Export] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
