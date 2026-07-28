import { NextResponse } from 'next/server';
import {
  initDatabase,
  getActiveAlerts,
  getAlertHistory,
  acknowledgeAlert,
  acknowledgeAllAlerts,
  getActiveAlertCount,
} from '@/lib/db';
import {
  startAutoScanner,
  stopAutoScanner,
  runManualSweep,
  getAutoScannerStatus,
} from '@/lib/auto-scanner';

export const dynamic = 'force-dynamic';

/**
 * GET /api/network/alerts
 * 
 * Query params:
 *   history=true  — include acknowledged alerts
 *   limit=N       — limit history results (default 100)
 *   count=true    — return only the count (for badge)
 *   scanner=true  — return auto-scanner status
 */
export async function GET(request: Request) {
  try {
    await initDatabase();
    
    const { searchParams } = new URL(request.url);
    const history = searchParams.get('history') === 'true';
    const countOnly = searchParams.get('count') === 'true';
    const scannerStatus = searchParams.get('scanner') === 'true';
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    
    // Return only count (for badge polling)
    if (countOnly) {
      const count = await getActiveAlertCount();
      return NextResponse.json({ count });
    }
    
    // Return auto-scanner status
    if (scannerStatus) {
      return NextResponse.json(getAutoScannerStatus());
    }
    
    // Return alerts
    if (history) {
      const alerts = await getAlertHistory(limit);
      return NextResponse.json({ alerts, total: alerts.length });
    }
    
    const alerts = await getActiveAlerts();
    const scanner = getAutoScannerStatus();
    return NextResponse.json({ alerts, total: alerts.length, scanner });
    
  } catch (err) {
    console.error('[Alerts API] GET error:', err);
    return NextResponse.json(
      { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/network/alerts
 * 
 * Body:
 *   { action: 'acknowledge', id: number }
 *   { action: 'acknowledge-all' }
 *   { action: 'run-diff' }
 *   { action: 'start-scanner', intervalMinutes?: number, subnet?: string }
 *   { action: 'stop-scanner' }
 */
export async function POST(request: Request) {
  try {
    await initDatabase();
    
    const body = await request.json();
    const action = body.action;
    
    switch (action) {
      case 'acknowledge': {
        const id = body.id;
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        const success = await acknowledgeAlert(id, body.acknowledgedBy);
        return NextResponse.json({ success, id });
      }
      
      case 'acknowledge-all': {
        const count = await acknowledgeAllAlerts(body.acknowledgedBy);
        return NextResponse.json({ success: true, acknowledged: count });
      }
      
      case 'run-diff': {
        const result = await runManualSweep();
        return NextResponse.json({
          success: true,
          hostsFound: result.hostsFound,
          newAlerts: result.newAlerts,
        });
      }
      
      case 'start-scanner': {
        const intervalMs = body.intervalMinutes 
          ? body.intervalMinutes * 60 * 1000 
          : undefined;
        startAutoScanner(intervalMs, body.subnet);
        return NextResponse.json({ 
          success: true, 
          status: getAutoScannerStatus(),
        });
      }
      
      case 'stop-scanner': {
        stopAutoScanner();
        return NextResponse.json({ 
          success: true, 
          status: getAutoScannerStatus(),
        });
      }
      
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    
  } catch (err) {
    console.error('[Alerts API] POST error:', err);
    return NextResponse.json(
      { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
