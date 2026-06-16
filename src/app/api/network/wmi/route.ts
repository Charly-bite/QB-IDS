/**
 * WMI Probe API — query a device for full hardware/software inventory.
 */

import { NextResponse } from 'next/server';
import { queryWMI } from '@/lib/wmi-probe';

export async function POST(request: Request) {
  try {
    const { ip } = await request.json();

    if (!ip || typeof ip !== 'string') {
      return NextResponse.json({ error: 'IP address is required' }, { status: 400 });
    }

    console.log(`[WMI] Querying ${ip}...`);
    const profile = await queryWMI(ip);
    console.log(`[WMI] ${ip}: ${profile.accessible ? 'Success' : `Failed: ${profile.error}`}`);

    return NextResponse.json(profile);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMI] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
