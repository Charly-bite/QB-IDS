/**
 * ARP Watch API — monitors the network for rogue devices and MAC changes.
 */

import { NextResponse } from 'next/server';
import { runARPWatch } from '@/lib/arp-watch';

export async function GET() {
  try {
    const result = await runARPWatch();

    console.log(`[ARP Watch] ${result.currentEntries} entries, ${result.alerts.length} alerts`);

    return NextResponse.json({
      entries: result.currentEntries,
      alerts: result.alerts,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ARP Watch] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
