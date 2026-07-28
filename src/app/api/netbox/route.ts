import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import {
  getDevices,
  getDevice,
  searchDevices,
  getIPAddresses,
  getPrefixes,
  getVLANs,
  getDeviceRoles,
  getSites,
  getOverview,
  testConnection,
  createDevice,
  updateDevice,
  getRegions,
  createRegion,
  getSiteGroups,
  createSiteGroup,
  getLocations,
  createLocation,
  type NetBoxDevice,
} from '@/lib/netbox-api';
import { ensureNetBoxSetup } from './sync/route';

/**
 * GET /api/netbox?action=overview|devices|device|ipam|vlans|search|test
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'overview';

  try {
    switch (action) {
      // ── Overview: Summary counts ──
      case 'overview': {
        const overview = await getOverview();
        return NextResponse.json(overview);
      }

      // ── All devices ──
      case 'devices': {
        const status = searchParams.get('status') || undefined;
        const role = searchParams.get('role') || undefined;
        const site = searchParams.get('site') || undefined;
        const filters: Record<string, string> = {};
        if (status) filters.status = status;
        if (role) filters.role = role;
        if (site) filters.site = site;

        const result = await getDevices(Object.keys(filters).length > 0 ? filters : undefined);
        if (result.error) {
          return NextResponse.json({ devices: [], error: result.error });
        }
        return NextResponse.json({
          devices: result.data?.results || [],
          count: result.data?.count || 0,
        });
      }

      // ── Single device detail ──
      case 'device': {
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
        const result = await getDevice(parseInt(id));
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data);
      }

      // ── IPAM: IP addresses, prefixes ──
      case 'ipam': {
        const [ipsRes, prefixesRes] = await Promise.all([
          getIPAddresses(),
          getPrefixes(),
        ]);

        return NextResponse.json({
          ipAddresses: ipsRes.data?.results || [],
          ipCount: ipsRes.data?.count || 0,
          prefixes: prefixesRes.data?.results || [],
          prefixCount: prefixesRes.data?.count || 0,
          error: ipsRes.error || prefixesRes.error || null,
        });
      }

      // ── VLANs ──
      case 'vlans': {
        const result = await getVLANs();
        if (result.error) return NextResponse.json({ vlans: [], error: result.error });
        return NextResponse.json({
          vlans: result.data?.results || [],
          count: result.data?.count || 0,
        });
      }

      // ── Device roles ──
      case 'roles': {
        const result = await getDeviceRoles();
        return NextResponse.json({
          roles: result.data?.results || [],
          error: result.error || null,
        });
      }

      // ── Sites ──
      case 'sites': {
        const result = await getSites();
        return NextResponse.json({
          sites: result.data?.results || [],
          error: result.error || null,
        });
      }

      // ── Regions ──
      case 'regions': {
        const result = await getRegions();
        return NextResponse.json({
          regions: result.data?.results || [],
          error: result.error || null,
        });
      }

      // ── Site Groups ──
      case 'site-groups': {
        const result = await getSiteGroups();
        return NextResponse.json({
          siteGroups: result.data?.results || [],
          error: result.error || null,
        });
      }

      // ── Locations ──
      case 'locations': {
        const result = await getLocations();
        return NextResponse.json({
          locations: result.data?.results || [],
          error: result.error || null,
        });
      }

      // ── Search ──
      case 'search': {
        const q = searchParams.get('q') || '';
        if (!q) return NextResponse.json({ devices: [], count: 0 });
        const result = await searchDevices(q);
        return NextResponse.json({
          devices: result.data?.results || [],
          count: result.data?.count || 0,
          error: result.error || null,
        });
      }

      // ── Test connection ──
      case 'test': {
        const conn = await testConnection();
        return NextResponse.json(conn);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('NetBox API route error:', err);
    return NextResponse.json(
      { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/netbox — Create or sync devices
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'create';

  try {
    const body = await request.json();

    switch (action) {
      case 'create': {
        const result = await createDevice(body);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data, { status: 201 });
      }

      case 'create-region': {
        const result = await createRegion(body);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data, { status: 201 });
      }

      case 'create-site-group': {
        const result = await createSiteGroup(body);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data, { status: 201 });
      }

      case 'create-location': {
        const result = await createLocation(body);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data, { status: 201 });
      }

      case 'sync-device': {
        const { ip, name, deviceType, vendor, roleId: bodyRoleId, siteId: bodySiteId } = body;
        if (!ip) return NextResponse.json({ error: 'ip is required' }, { status: 400 });
        const devName = name || `device-${ip.replace(/\./g, '-')}`;

        // Check if device already exists in NetBox by IP or Name
        const existingRes = await getDevices();
        const existing = existingRes.data?.results || [];

        const dupByName = existing.find(d => d.name?.toLowerCase() === devName.toLowerCase());
        const dupByIp = existing.find(d => {
          const primIp = d.primary_ip4?.address || d.primary_ip?.address;
          return primIp && primIp.split('/')[0] === ip;
        });

        if (dupByIp) {
          return NextResponse.json({ success: true, alreadyExists: true, id: dupByIp.id });
        }
        if (dupByName) {
          return NextResponse.json({ success: true, alreadyExists: true, id: dupByName.id });
        }

        // Ensure site, type, and roles exist
        const setup = await ensureNetBoxSetup();
        if (setup.error) {
          return NextResponse.json({ error: `NetBox setup error: ${setup.error}` }, { status: 500 });
        }

        const roles = setup.roles;
        const findRole = (slug: string) => roles.find(r => r.slug === slug)?.id || roles[0]?.id || 1;

        let roleId = bodyRoleId ? parseInt(bodyRoleId) : findRole('unknown');
        if (!bodyRoleId) {
          if (deviceType) {
            const typeLower = deviceType.toLowerCase();
            if (typeLower === 'server' || typeLower === 'database') roleId = findRole('server');
            else if (['switch', 'router', 'firewall', 'access-point'].includes(typeLower)) roleId = findRole('network');
            else if (typeLower === 'workstation' || typeLower === 'pc') roleId = findRole('workstation');
            else if (typeLower === 'printer') roleId = findRole('printer');
            else if (['camera', 'nvr', 'surveillance'].includes(typeLower)) roleId = findRole('surveillance');
            else if (['phone', 'voip-phone'].includes(typeLower)) roleId = findRole('ip-phone');
          } else if (vendor) {
            const vLower = vendor.toLowerCase();
            if (vLower.includes('hikvision') || vLower.includes('dahua')) roleId = findRole('surveillance');
            else if (vLower.includes('brother') || vLower.includes('canon') || vLower.includes('epson') || vLower.includes('ricoh')) roleId = findRole('printer');
          }
        }

        const typeId = setup.defaultTypeId;
        const siteId = bodySiteId ? parseInt(bodySiteId) : setup.siteId;

        // Create the device
        const createResult = await createDevice({
          name: devName.slice(0, 64),
          device_type: typeId,
          role: roleId,
          site: siteId,
          status: 'active',
          comments: `Synced from Panel Control Discovery (IP: ${ip}, Vendor: ${vendor || 'unknown'})`,
        });

        if (createResult.error) {
          return NextResponse.json({ error: createResult.error }, { status: 500 });
        }

        const newDevice = createResult.data;
        if (!newDevice?.id) {
          return NextResponse.json({ error: 'Device creation failed' }, { status: 500 });
        }

        // Create associated IP address
        const apiUrl = process.env.NETBOX_API_URL || 'http://192.168.2.134:8085/api';
        const apiToken = process.env.NETBOX_API_TOKEN || '';
        await fetch(`${apiUrl}/ipam/ip-addresses/`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${apiToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            address: `${ip}/24`,
            status: 'active',
            assigned_object_type: 'dcim.device',
            assigned_object_id: newDevice.id,
            dns_name: devName,
            description: `Discovery IP for ${devName}`,
          }),
        }).catch(() => {});

        return NextResponse.json({ success: true, created: true, id: newDevice.id }, { status: 201 });
      }

      case 'update': {
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
        const result = await updateDevice(parseInt(id), body);
        if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json(result.data);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error('NetBox POST error:', err);
    return NextResponse.json(
      { error: `Internal error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
