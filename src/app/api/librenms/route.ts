import { NextResponse } from 'next/server';

// Force Next.js to treat this route as dynamic — never cache responses
export const dynamic = 'force-dynamic';
import {
  getDevices,
  getAlerts,
  getDevice,
  deleteDevice,
  getDevicePorts,
  getDeviceAvailability,
  getDeviceHealth,
  getDeviceHealthCategories,
  getDeviceGraphImage,
  getDeviceMetrics,
  getAllDevicesStorage,
  testConnection,
  type LibreNMSDevice,
} from '@/lib/librenms-api';
import { getAllDevices } from '@/lib/db';
import { maybeSyncLibreNMS } from '@/lib/librenms-sync';

// Cache devices list for 60s to avoid hammering the API
let devicesCache: { devices: LibreNMSDevice[]; timestamp: number } | null = null;
const CACHE_TTL = 60000; // 60s

async function getCachedDevices(): Promise<LibreNMSDevice[]> {
  if (devicesCache && Date.now() - devicesCache.timestamp < CACHE_TTL) {
    return devicesCache.devices;
  }
  const result = await getDevices();
  const devices = (result.data as { devices?: LibreNMSDevice[] })?.devices || [];
  devicesCache = { devices, timestamp: Date.now() };
  return devices;
}

/**
 * GET /api/librenms
 * 
 * Aggregated LibreNMS data endpoint for the Panel Control dashboard.
 * Query params:
 *   ?action=overview        — devices + alerts summary (default)
 *   ?action=devices         — all devices
 *   ?action=alerts          — active alerts
 *   ?action=device&id=      — single device detail + ports + availability
 *   ?action=device-by-ip&ip=— lookup device by IP address
 *   ?action=health&id=      — device health sensors
 *   ?action=graph&id=&type= — proxy a graph image from LibreNMS
 *   ?action=test            — test API connectivity
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'overview';
  const deviceId = searchParams.get('id');

  try {
    switch (action) {
      case 'test': {
        const result = await testConnection();
        return NextResponse.json(result);
      }

      case 'devices': {
        const result = await getDevices();
        if (result.error) {
          return NextResponse.json({ error: result.error, devices: [] }, { status: 502 });
        }
        return NextResponse.json(result.data);
      }

      case 'alerts': {
        const result = await getAlerts();
        if (result.error) {
          return NextResponse.json({ error: result.error, alerts: [] }, { status: 502 });
        }
        return NextResponse.json(result.data);
      }

      case 'device': {
        if (!deviceId) {
          return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }
        const [deviceRes, portsRes, availRes, healthRes] = await Promise.all([
          getDevice(deviceId),
          getDevicePorts(Number(deviceId)),
          getDeviceAvailability(Number(deviceId)),
          getDeviceHealthCategories(Number(deviceId)),
        ]);
        return NextResponse.json({
          device: deviceRes.data,
          ports: portsRes.data,
          availability: availRes.data,
          healthCategories: healthRes.data,
          errors: {
            device: deviceRes.error,
            ports: portsRes.error,
            availability: availRes.error,
            health: healthRes.error,
          },
        });
      }

      // Lookup device by IP address — bridges Panel Control's IP-based config
      // with LibreNMS's device IDs
      case 'device-by-ip': {
        const ip = searchParams.get('ip');
        if (!ip) {
          return NextResponse.json({ error: 'Missing ip parameter' }, { status: 400 });
        }
        const devices = await getCachedDevices();
        const found = devices.find(d => d.hostname === ip || d.ip === ip);
        if (!found) {
          return NextResponse.json({ found: false, device: null });
        }

        // Get additional data for the found device
        const [availRes, healthRes] = await Promise.all([
          getDeviceAvailability(found.device_id),
          getDeviceHealthCategories(found.device_id),
        ]);

        return NextResponse.json({
          found: true,
          device: found,
          availability: availRes.data,
          healthCategories: healthRes.data,
        });
      }

      // Proxy a graph image from LibreNMS (keeps API token server-side)
      case 'graph': {
        if (!deviceId) {
          return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }
        const graphType = searchParams.get('type') || 'device_processor';
        const from = searchParams.get('from') || '-1d';
        const width = Number(searchParams.get('width') || 500);
        const height = Number(searchParams.get('height') || 150);

        const result = await getDeviceGraphImage(Number(deviceId), graphType, from, width, height);
        if (result.error || !result.data) {
          return NextResponse.json({ error: result.error || 'No data' }, { status: 502 });
        }

        return new NextResponse(new Uint8Array(result.data), {
          headers: {
            'Content-Type': result.contentType,
            'Cache-Control': 'public, max-age=60',
          },
        });
      }

      case 'health': {
        if (!deviceId) {
          return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }
        const sensorType = searchParams.get('sensor') || undefined;
        const result = await getDeviceHealth(Number(deviceId), sensorType);
        return NextResponse.json(result.data || { error: result.error });
      }

      // Aggregated device metrics — CPU, memory, disk, ports, availability
      case 'device-metrics': {
        if (!deviceId) {
          return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }
        const metrics = await getDeviceMetrics(Number(deviceId));
        return NextResponse.json(metrics);
      }

      // Enriched overview — cross-references LibreNMS devices with Panel Control MSSQL
      case 'overview-enriched': {
        const [devicesRes, alertsRes] = await Promise.all([
          getDevices(),
          getAlerts(),
        ]);

        const lnmsDevices = (devicesRes.data as { devices?: LibreNMSDevice[] })?.devices || [];
        const alerts = (alertsRes.data as { alerts?: Array<{ id: number; hostname: string; rule: string; severity: string; state: number; timestamp: string }> })?.alerts || [];

        // Try to fetch Panel Control MSSQL devices for cross-referencing
        let pcDevices: { ip: string; name: string; device_type: string; status: string; latency: number; is_monitored: boolean }[] = [];
        let dbError: string | null = null;
        try {
          pcDevices = (await getAllDevices()) as typeof pcDevices;
        } catch (e) {
          dbError = String(e);
        }

        // Build a lookup map of Panel Control devices by IP
        const pcByIp = new Map(pcDevices.map(d => [d.ip, d]));

        // Enrich LibreNMS devices with Panel Control data
        const enrichedDevices = lnmsDevices.map(d => {
          const pcMatch = pcByIp.get(d.ip) || pcByIp.get(d.hostname);
          return {
            ...d,
            panelControl: pcMatch ? {
              name: pcMatch.name,
              device_type: pcMatch.device_type,
              latency: pcMatch.latency,
              is_monitored: pcMatch.is_monitored,
              matched: true,
            } : null,
          };
        });

        const totalDevices = lnmsDevices.length;
        const devicesUp = lnmsDevices.filter(d => d.status === 1).length;
        const devicesDown = lnmsDevices.filter(d => d.status === 0).length;
        const osCounts: Record<string, number> = {};
        lnmsDevices.forEach(d => {
          const os = d.os || 'unknown';
          osCounts[os] = (osCounts[os] || 0) + 1;
        });

        return NextResponse.json({
          summary: {
            totalDevices,
            devicesUp,
            devicesDown,
            activeAlerts: alerts.length,
            osCounts,
            panelControlDevices: pcDevices.length,
            crossLinked: enrichedDevices.filter(d => d.panelControl).length,
          },
          devices: enrichedDevices,
          alerts,
          errors: {
            devices: devicesRes.error,
            alerts: alertsRes.error,
            panelControl: dbError,
          },
        });
      }

      // Top disk usage across all devices — powers "TOP - USO DE DISCO DURO" widget
      case 'top-storage': {
        const limit = Number(searchParams.get('limit') || 20);
        const result = await getAllDevicesStorage(limit);
        return NextResponse.json(result);
      }

      case 'overview':
      default: {
        // Lazily trigger background sync with MSSQL
        maybeSyncLibreNMS();

        // Fetch devices and alerts in parallel for dashboard overview
        const [devicesRes, alertsRes] = await Promise.all([
          getDevices(),
          getAlerts(),
        ]);

        const devices = (devicesRes.data as { devices?: LibreNMSDevice[] })?.devices || [];
        const alerts = (alertsRes.data as { alerts?: Array<{ id: number; hostname: string; rule: string; severity: string; state: number; timestamp: string }> })?.alerts || [];

        // Compute summary stats
        const totalDevices = devices.length;
        const devicesUp = devices.filter((d) => d.status === 1).length;
        const devicesDown = devices.filter((d) => d.status === 0).length;
        const activeAlerts = alerts.length;

        // Group devices by OS for quick stats
        const osCounts: Record<string, number> = {};
        devices.forEach(d => {
          const os = d.os || 'unknown';
          osCounts[os] = (osCounts[os] || 0) + 1;
        });

        return NextResponse.json({
          summary: {
            totalDevices,
            devicesUp,
            devicesDown,
            activeAlerts,
            osCounts,
          },
          devices,
          alerts,
          errors: {
            devices: devicesRes.error,
            alerts: alertsRes.error,
          },
        });
      }
    }
  } catch (err) {
    console.error('[LibreNMS API] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error', detail: String(err) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/librenms?id=<device_id>
 *
 * Remove a device from LibreNMS.
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('id');

  if (!deviceId || isNaN(Number(deviceId))) {
    return NextResponse.json(
      { error: 'Missing or invalid device ID' },
      { status: 400 }
    );
  }

  try {
    const result = await deleteDevice(Number(deviceId));
    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (err) {
    console.error('[LibreNMS API] DELETE error:', err);
    return NextResponse.json(
      { error: 'Failed to delete device', detail: String(err) },
      { status: 500 }
    );
  }
}
