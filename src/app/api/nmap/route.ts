import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  startScan,
  getScanResult,
  listScans,
  cancelScan,
  quickScan,
  discoverSubnet,
  testConnection,
  type ScanType,
} from '@/lib/nmap-api';

/**
 * GET /api/nmap?action=result|scans|quick|discover|test
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'test';

  try {
    switch (action) {
      // ── Get scan result ──
      case 'result': {
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
        const result = await getScanResult(id);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data);
      }

      // ── List all scans ──
      case 'scans': {
        const result = await listScans();
        if (result.error) return NextResponse.json({ scans: [], error: result.error });
        return NextResponse.json(result.data);
      }

      // ── Quick single-host scan (synchronous, ~10-30s) ──
      case 'quick': {
        const ip = searchParams.get('ip');
        if (!ip) return NextResponse.json({ error: 'ip parameter required' }, { status: 400 });
        const result = await quickScan(ip);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data);
      }

      // ── Discover live hosts in subnet ──
      case 'discover': {
        const subnet = searchParams.get('subnet');
        if (!subnet) return NextResponse.json({ error: 'subnet parameter required' }, { status: 400 });
        const result = await discoverSubnet(subnet);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data);
      }

      // ── Test connection to Nmap API ──
      case 'test': {
        const conn = await testConnection();
        return NextResponse.json(conn);
      }

      // ── ARP table from gateway via SNMP ──
      case 'arp': {
        const gateway = searchParams.get('gateway') || '192.168.2.1';
        const community = searchParams.get('community') || 'qboss';
        const baseUrl = process.env.NMAP_API_URL || 'http://192.168.2.134:5001';
        const res = await fetch(`${baseUrl}/arp?gateway=${gateway}&community=${community}`);
        const data = await res.json();
        if (!res.ok) return NextResponse.json(data, { status: res.status });
        return NextResponse.json(data);
      }

      // ── DNS reverse lookups ──
      case 'dns-reverse': {
        // Handled in POST, but allow GET with comma-separated IPs for convenience
        const ips = searchParams.get('ips')?.split(',').filter(Boolean) || [];
        if (ips.length === 0) return NextResponse.json({ error: 'ips parameter required' }, { status: 400 });
        const baseUrl = process.env.NMAP_API_URL || 'http://192.168.2.134:5001';
        const res = await fetch(`${baseUrl}/dns-reverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ips }),
        });
        const data = await res.json();
        return NextResponse.json(data);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Nmap API route error:', err);
    return NextResponse.json(
      { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/nmap?action=scan
 * 
 * Body: { target: string, scan_type?: "quick"|"ports"|"full"|"os"|"aggressive"|"vuln" }
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'scan';

  try {
    const body = await request.json();

    switch (action) {
      case 'scan': {
        const target = body.target;
        const scanType = (body.scan_type || 'full') as ScanType;

        if (!target) {
          return NextResponse.json({ error: 'target is required' }, { status: 400 });
        }

        const result = await startScan(target, scanType);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data, { status: 202 });
      }

      case 'cancel': {
        const scanId = body.scan_id;
        if (!scanId) return NextResponse.json({ error: 'scan_id is required' }, { status: 400 });
        const result = await cancelScan(scanId);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('Nmap POST error:', err);
    return NextResponse.json(
      { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
